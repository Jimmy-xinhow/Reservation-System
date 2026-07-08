"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listChatThreads,
  getChatMessages,
  sendStaffChat,
  type ChatThread,
  type ChatMsg,
} from "./actions";

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
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await listChatThreads());
    } catch {
      /* 靜默:輪詢失敗不打斷操作 */
    }
  }, []);

  const loadMessages = useCallback(async (uid: string) => {
    try {
      setMessages(await getChatMessages(uid));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "載入失敗");
    }
  }, []);

  // 對話串列表每 5 秒輪詢
  useEffect(() => {
    const t = setInterval(refreshThreads, 5000);
    return () => clearInterval(t);
  }, [refreshThreads]);

  // 選定對話串:立即載入 + 每 3 秒輪詢
  useEffect(() => {
    if (!active) return;
    loadMessages(active);
    const t = setInterval(() => loadMessages(active), 3000);
    return () => clearInterval(t);
  }, [active, loadMessages]);

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || !active || sending) return;
    setSending(true);
    setErr(null);
    try {
      await sendStaffChat(active, body);
      setText("");
      await loadMessages(active);
      refreshThreads();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "送出失敗");
    } finally {
      setSending(false);
    }
  }

  function openThread(uid: string) {
    setActive(uid);
    setMessages([]);
    lastCount.current = 0;
    // 樂觀清掉未讀
    setThreads((ts) => ts.map((t) => (t.lineUserId === uid ? { ...t, unread: 0 } : t)));
  }

  const activeThread = threads.find((t) => t.lineUserId === active) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      {/* 對話串列表 */}
      <div className="card max-h-[70vh] overflow-y-auto p-0">
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
                      {t.name ?? "未建檔病患"}
                    </span>
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
      </div>

      {/* 訊息串 + 回覆 */}
      <div className="card flex flex-col p-0">
        {!activeThread ? (
          <div className="flex h-[70vh] items-center justify-center text-sm text-slate-400">
            請選擇左側對話
          </div>
        ) : (
          <>
            <div className="border-b border-slate-100 px-4 py-3">
              <span className="font-semibold text-slate-800">
                {activeThread.name ?? "未建檔病患"}
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" style={{ height: "50vh" }}>
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
                        {m.body}
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
                placeholder="輸入回覆…(Enter 送出,Shift+Enter 換行)"
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
      </div>
    </div>
  );
}
