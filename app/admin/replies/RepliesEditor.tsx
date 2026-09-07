"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export interface Reply {
  id: string;
  keywords: string;
  action: string;
  reply_text: string | null;
  message_id: string | null;
  sort: number;
  active: boolean;
}
type ServerAction = (fd: FormData) => Promise<void>;

const ACTION_LABEL: Record<string, string> = {
  text: "回覆自訂文字",
  message: "回覆訊息素材",
  booking: "開啟預約",
  query: "查詢預約",
  progress: "服務進度",
};

export default function RepliesEditor({
  replies,
  messages,
  createAction,
  updateAction,
  toggleAction,
  deleteAction,
}: {
  replies: Reply[];
  messages: { id: string; name: string }[];
  createAction: ServerAction;
  updateAction: ServerAction;
  toggleAction: ServerAction;
  deleteAction: ServerAction;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState("");
  const [action, setAction] = useState("text");
  const [replyText, setReplyText] = useState("");
  const [messageId, setMessageId] = useState("");
  const [sort, setSort] = useState("0");
  const formRef = useRef<HTMLFormElement>(null);

  function edit(r: Reply) {
    setEditingId(r.id);
    setKeywords(r.keywords);
    setAction(r.action);
    setReplyText(r.reply_text ?? "");
    setMessageId(r.message_id ?? "");
    setSort(String(r.sort));
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function cancel() {
    setEditingId(null);
    setKeywords("");
    setAction("text");
    setReplyText("");
    setMessageId("");
    setSort("0");
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">關鍵字回覆規則</h2><p className="mt-0.5 text-xs text-slate-500">排序數字較小的規則會先比對，第一個符合的規則立即生效。</p></div><span className="text-xs tabular-nums text-slate-500">{replies.length} 筆</span></div>
      <form
        ref={formRef}
        action={editingId ? updateAction : createAction}
        className={`grid scroll-mt-24 gap-4 border-b border-slate-200 p-4 lg:grid-cols-2 ${editingId ? "bg-brand-50/40" : "bg-white"}`}
      >
        <h3 className="font-semibold text-slate-900 lg:col-span-2">{editingId ? "編輯回覆規則" : "新增回覆規則"}</h3>
        {editingId && <input type="hidden" name="id" value={editingId} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
          <label className="text-sm">
            <span className="label">觸發關鍵字（逗號分隔）</span>
            <input
              name="keywords"
              required
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="例如：進度、報到、號次"
              className="input"
            />
          </label>
          <label className="text-sm">
            <span className="label">符合後要執行的動作</span>
            <select name="action" value={action} onChange={(e) => setAction(e.target.value)} className="input">
              {Object.entries(ACTION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        {action === "text" && (
          <label className="block text-sm lg:col-span-2">
            <span className="label">回覆文字</span>
            <textarea
              name="reply_text"
              rows={2}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="顧客輸入關鍵字時回覆的內容"
              className="input"
            />
          </label>
        )}
        {action === "message" && (
          <label className="block text-sm lg:col-span-2">
            <span className="label">選擇訊息素材</span>
            <select name="message_id" value={messageId} onChange={(e) => setMessageId(e.target.value)} className="input">
              <option value="">請選擇</option>
              {messages.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {messages.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">尚無訊息素材，請先到「訊息素材」建立。</p>
            )}
          </label>
        )}
        <div className="flex flex-wrap items-end gap-3 lg:col-span-2">
          <label className="text-sm">
            <span className="label">比對順序</span>
            <input
              name="sort"
              type="number"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="input w-20"
            />
          </label>
          <SubmitButton className="btn btn-primary">{editingId ? "儲存規則修改" : "新增回覆規則"}</SubmitButton>
          {editingId && (
            <button type="button" onClick={cancel} className="btn btn-secondary">
              取消編輯
            </button>
          )}
        </div>
      </form>

      <div className="admin-table-shell admin-table-mobile-cards border-0">
        <table className="tbl">
          <thead>
            <tr>
              <th>關鍵字</th>
              <th>動作</th>
              <th>回覆文字</th>
              <th>排序</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {replies.length === 0 && (
              <tr>
                <td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">
                  尚未建立關鍵字回覆規則
                </td>
              </tr>
            )}
            {replies.map((r) => (
              <tr key={r.id} className={editingId === r.id ? "bg-brand-50/60" : ""}>
                <td data-label="關鍵字" className="font-medium text-slate-800">{r.keywords}</td>
                <td data-label="執行動作">{ACTION_LABEL[r.action] ?? r.action}</td>
                <td data-label="回覆內容" className="max-w-[16rem] text-slate-500">{r.reply_text || "使用訊息素材或系統入口"}</td>
                <td data-label="比對順序" className="text-slate-500">{r.sort}</td>
                <td data-label="狀態">
                  <span className={`badge ${r.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                    {r.active ? "啟用" : "停用"}
                  </span>
                </td>
                <td data-label="操作">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => edit(r)}
                      className="admin-inline-action text-brand-700"
                    >
                      編輯規則
                    </button>
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="active" value={String(r.active)} />
                      <SubmitButton className="admin-inline-action">
                        {r.active ? "停用規則" : "啟用規則"}
                      </SubmitButton>
                    </form>
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <ConfirmSubmitButton confirmMessage="刪除後，顧客輸入這些關鍵字時將不再套用此規則。確定刪除嗎？" className="admin-inline-action text-red-700">刪除規則</ConfirmSubmitButton>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
