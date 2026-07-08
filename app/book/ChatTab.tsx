"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { linkify } from "@/lib/linkify";

interface ChatMsg {
  id: string;
  sender: "patient" | "staff";
  body: string;
  created_at: string;
}

async function post<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!json) throw new Error("伺服器回應異常");
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function ChatTab({ idToken }: { idToken: string | null }) {
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    if (!idToken) return;
    try {
      const data = await post<{ messages: ChatMsg[] }>("/api/chat/messages", { idToken });
      setMessages(data.messages);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "載入失敗");
    }
  }, [idToken]);

  // 首次載入 + 每 3 秒輪詢(系統內即時,不經 LINE)
  useEffect(() => {
    if (!idToken) return;
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [idToken, load]);

  // 有新訊息才捲到底
  useEffect(() => {
    if (messages && messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || !idToken || sending) return;
    setSending(true);
    setErr(null);
    try {
      await post("/api/chat/send", { idToken, body });
      setText("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "送出失敗");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 200px)" }}>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
        {messages === null ? (
          <p className="pt-8 text-center text-sm text-slate-400">載入中…</p>
        ) : messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-slate-400">
            有任何問題都可以在這裡留言,櫃檯會盡快回覆您 🙌
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender === "patient";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  <div
                    className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                      mine
                        ? "rounded-br-sm bg-brand-600 text-white"
                        : "rounded-bl-sm bg-white text-slate-800 shadow-sm"
                    }`}
                  >
                    {linkify(m.body)}
                  </div>
                  <span className="mt-0.5 px-1 text-[10px] text-slate-400">
                    {mine ? "" : "櫃檯 · "}
                    {fmtTime(m.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="mt-3 flex items-end gap-2">
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
          placeholder={idToken ? "輸入訊息…" : "確認身分中…"}
          disabled={!idToken}
          className="input max-h-28 min-h-[42px] flex-1 resize-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={!idToken || sending || !text.trim()}
          className="btn btn-primary shrink-0"
        >
          {sending ? "送出中…" : "送出"}
        </button>
      </div>
    </div>
  );
}
