"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { linkify } from "@/lib/linkify";

export interface ChatThread {
  lineUserId: string;
  name: string | null;
  lastBody: string;
  lastAt: string;
  lastSender: "patient" | "staff";
  unread: number;
  blocked: boolean;
}
interface ChatMsg {
  id: string;
  sender: "patient" | "staff";
  body: string;
  created_at: string;
}
interface ChatMessagePage {
  messages: ChatMsg[];
  hasMore: boolean;
  nextCursor: string | null;
}

function mergeMessages(existing: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => {
    const timeDifference = Date.parse(a.created_at) - Date.parse(b.created_at);
    return timeDifference || a.id.localeCompare(b.id);
  });
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!json || !json.ok) throw new Error(json && !json.ok ? json.error : "讀取失敗");
  return json.data;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function ChatConsole({ initialThreads }: { initialThreads: ChatThread[] }) {
  const [threads, setThreads] = useState<ChatThread[]>(initialThreads);
  const [active, setActive] = useState<string | null>(initialThreads[0]?.lineUserId ?? null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastNewestId = useRef<string | null>(null);
  const activeRef = useRef(active);
  const olderLoadedRef = useRef(false);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads((await getJSON<{ threads: ChatThread[] }>("/api/admin/chat?type=threads")).threads);
    } catch {
      /* 靜默:輪詢失敗不打斷操作 */
    }
  }, []);

  const loadMessages = useCallback(async (uid: string) => {
    try {
      const data = await getJSON<ChatMessagePage>(
        `/api/admin/chat?type=messages&u=${encodeURIComponent(uid)}`,
      );
      if (activeRef.current !== uid) return;
      setMessages((current) => mergeMessages(current, data.messages));
      if (!olderLoadedRef.current) {
        setOlderCursor(data.nextCursor);
        setHasOlder(data.hasMore);
      }
    } catch (e) {
      if (activeRef.current === uid) setErr(e instanceof Error ? e.message : "載入失敗");
    }
  }, []);

  async function loadOlder() {
    if (!active || !hasOlder || !olderCursor || loadingOlder) return;
    const uid = active;
    setLoadingOlder(true);
    setErr(null);
    try {
      const data = await getJSON<ChatMessagePage>(
        `/api/admin/chat?type=messages&u=${encodeURIComponent(uid)}&before=${encodeURIComponent(olderCursor)}`,
      );
      if (activeRef.current !== uid) return;
      setMessages((current) => mergeMessages(current, data.messages));
      olderLoadedRef.current = true;
      setOlderCursor(data.nextCursor);
      setHasOlder(data.hasMore);
    } catch (e) {
      if (activeRef.current === uid) setErr(e instanceof Error ? e.message : "載入更早訊息失敗");
    } finally {
      if (activeRef.current === uid) setLoadingOlder(false);
    }
  }

  useEffect(() => {
    const t = setInterval(refreshThreads, 5000);
    return () => clearInterval(t);
  }, [refreshThreads]);

  useEffect(() => {
    if (!active) return;
    loadMessages(active);
    const t = setInterval(() => loadMessages(active), 3000);
    return () => clearInterval(t);
  }, [active, loadMessages]);

  useEffect(() => {
    const newestId = messages.at(-1)?.id ?? null;
    if (newestId !== lastNewestId.current) {
      lastNewestId.current = newestId;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || !active || sending) return;
    setSending(true);
    setErr(null);
    // 樂觀更新:先把訊息顯示出來,送出即時有反應
    const optimistic: ChatMsg = {
      id: `tmp-${messages.length}-${body.length}`,
      sender: "staff",
      body,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setText("");
    let explicitlyRejected = false;
    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId: active, body }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { messageId?: string; notice?: string } } | null;
      explicitlyRejected = json?.ok === false;
      if (!json?.ok) throw new Error(json?.error ?? "無法確認送出結果，請先核對對話，勿重複送出。");
      const committedId = json.data?.messageId;
      if (committedId) {
        setMessages((current) => current.map((message) => message.id === optimistic.id
          ? { ...message, id: committedId } : message));
      }
      await loadMessages(active); // 用真實資料取代樂觀訊息
      refreshThreads();
      if (json.data?.notice) setErr(json.data.notice);
    } catch (e) {
      // Only a received rejection proves that sending did not proceed.
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      if (explicitlyRejected) setText(body);
      setErr(explicitlyRejected && e instanceof Error ? e.message : "無法確認送出結果，請先核對對話，勿重複送出。");
    } finally {
      setSending(false);
    }
  }

  function openThread(uid: string) {
    activeRef.current = uid;
    olderLoadedRef.current = false;
    setActive(uid);
    setMessages([]);
    setOlderCursor(null);
    setHasOlder(false);
    setLoadingOlder(false);
    lastNewestId.current = null;
    setThreads((ts) => ts.map((t) => (t.lineUserId === uid ? { ...t, unread: 0 } : t)));
  }

  async function toggleBlock(uid: string, block: boolean) {
    if (block && !confirm("封鎖後，對方在客服送出的訊息將被忽略（對方不會收到提示）。確定封鎖？")) return;
    setErr(null);
    // 樂觀更新
    setThreads((ts) => ts.map((t) => (t.lineUserId === uid ? { ...t, blocked: block } : t)));
    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: block ? "block" : "unblock", lineUserId: uid }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!json?.ok) throw new Error(json?.error ?? "操作失敗");
      refreshThreads();
    } catch (e) {
      setThreads((ts) => ts.map((t) => (t.lineUserId === uid ? { ...t, blocked: !block } : t)));
      setErr(e instanceof Error ? e.message : "操作失敗");
    }
  }

  const activeThread = threads.find((t) => t.lineUserId === active) ?? null;

  if (threads.length === 0) {
    return (
      <section className="admin-section">
        <div className="px-5 py-12 text-center">
          <h2 className="text-base font-semibold text-slate-800">目前沒有客服對話</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">顧客從公開預約頁的「線上客服」送出第一則訊息後，對話會出現在這裡並自動更新。</p>
        </div>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
      {/* 對話串列表 */}
      <section className="admin-section max-h-[70vh] overflow-y-auto">
        {threads.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">尚無對話</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {threads.map((t) => (
              <li key={t.lineUserId}>
                <button
                  type="button"
                  onClick={() => openThread(t.lineUserId)}
                  className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors ${
                    active === t.lineUserId ? "bg-brand-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-800">
                      {t.name ?? "未建檔顧客"}
                    </span>
                    {t.blocked && (
                      <span className="shrink-0 rounded bg-slate-200 px-1.5 text-[10px] font-medium text-slate-500">
                        已封鎖
                      </span>
                    )}
                    {t.unread > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                        {t.unread}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-slate-400">
                      {t.lastSender === "staff" ? "櫃檯:" : ""}
                      {t.lastBody}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-300">
                      {fmtTime(t.lastAt)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 訊息串 + 回覆 */}
      <section className="admin-section flex min-h-[420px] flex-col">
        {!activeThread ? (
          <div className="flex h-[70vh] items-center justify-center text-sm text-slate-400">
            請先選擇一則顧客對話
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <span className="font-semibold text-slate-800">
                {activeThread.name ?? "未建檔顧客"}
              </span>
              {activeThread.blocked && (
                <span className="rounded bg-slate-200 px-1.5 text-[10px] font-medium text-slate-500">
                  已封鎖
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleBlock(activeThread.lineUserId, !activeThread.blocked)}
                className={`ml-auto text-xs font-medium hover:underline ${
                  activeThread.blocked ? "text-brand-600" : "text-red-600"
                }`}
              >
                {activeThread.blocked ? "解除顧客封鎖" : "封鎖此顧客"}
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" style={{ height: "50vh" }}>
              {hasOlder && (
                <div className="text-center">
                  <button type="button" onClick={loadOlder} disabled={loadingOlder}
                    className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50">
                    {loadingOlder ? "載入中…" : "載入更早訊息"}
                  </button>
                </div>
              )}
              {messages.map((m) => {
                const staff = m.sender === "staff";
                return (
                  <div key={m.id} className={`flex ${staff ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[70%] flex-col ${staff ? "items-end" : "items-start"}`}>
                      <div
                        className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                          staff
                            ? "rounded-br-sm bg-brand-600 text-white"
                            : "rounded-bl-sm bg-white text-slate-800 shadow-sm"
                        }`}
                      >
                        {linkify(m.body)}
                      </div>
                      <span className="mt-0.5 px-1 text-[10px] text-slate-400">{fmtTime(m.created_at)}</span>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {err && <p className="mx-4 mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

            <div className="flex items-end gap-2 border-t border-slate-100 p-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="輸入回覆…（Enter 送出，Shift+Enter 換行）"
                className="input max-h-28 min-h-[42px] flex-1 resize-none"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !text.trim()}
                className="btn btn-primary shrink-0"
              >
                {sending ? "送出中…" : "送出"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
