"use client";

import { useState } from "react";

export interface Reply {
  id: string;
  keywords: string;
  action: string;
  reply_text: string | null;
  sort: number;
  active: boolean;
}
type ServerAction = (fd: FormData) => Promise<void>;

const ACTION_LABEL: Record<string, string> = {
  text: "回覆自訂文字",
  booking: "開啟預約",
  query: "查詢預約",
  progress: "看診進度",
};

export default function RepliesEditor({
  replies,
  createAction,
  updateAction,
  toggleAction,
  deleteAction,
}: {
  replies: Reply[];
  createAction: ServerAction;
  updateAction: ServerAction;
  toggleAction: ServerAction;
  deleteAction: ServerAction;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState("");
  const [action, setAction] = useState("text");
  const [replyText, setReplyText] = useState("");
  const [sort, setSort] = useState("0");

  function edit(r: Reply) {
    setEditingId(r.id);
    setKeywords(r.keywords);
    setAction(r.action);
    setReplyText(r.reply_text ?? "");
    setSort(String(r.sort));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancel() {
    setEditingId(null);
    setKeywords("");
    setAction("text");
    setReplyText("");
    setSort("0");
  }

  return (
    <section className="space-y-3">
      <form
        action={editingId ? updateAction : createAction}
        className={`card space-y-4 p-5 ${editingId ? "ring-2 ring-brand-200" : ""}`}
      >
        <h2 className="font-semibold text-slate-900">{editingId ? "編輯回覆規則" : "新增回覆規則"}</h2>
        {editingId && <input type="hidden" name="id" value={editingId} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">觸發關鍵字(逗號分隔,任一命中)</span>
            <input
              name="keywords"
              required
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="例:進度, 叫號, 看診號"
              className="input"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">動作</span>
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
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">回覆文字</span>
            <textarea
              name="reply_text"
              rows={2}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="病患輸入關鍵字時回覆的內容"
              className="input"
            />
          </label>
        )}
        <div className="flex items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">排序</span>
            <input
              name="sort"
              type="number"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="input w-20"
            />
          </label>
          <button className="btn btn-primary">{editingId ? "儲存修改" : "新增"}</button>
          {editingId && (
            <button type="button" onClick={cancel} className="btn btn-secondary">
              取消
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400">
          由上到下(排序小的優先)比對;第一個命中的規則生效。動作「回覆自訂文字」才需填回覆文字。
        </p>
      </form>

      <div className="card overflow-x-auto">
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
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  尚無規則
                </td>
              </tr>
            )}
            {replies.map((r) => (
              <tr key={r.id} className={editingId === r.id ? "bg-brand-50/60" : ""}>
                <td className="font-medium text-slate-800">{r.keywords}</td>
                <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                <td className="max-w-[16rem] truncate text-slate-500">{r.reply_text || "—"}</td>
                <td className="text-slate-500">{r.sort}</td>
                <td>
                  <span className={`badge ${r.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                    {r.active ? "啟用" : "停用"}
                  </span>
                </td>
                <td>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => edit(r)}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      編輯
                    </button>
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="active" value={String(r.active)} />
                      <button className="text-xs font-medium text-slate-600 hover:underline">
                        {r.active ? "停用" : "啟用"}
                      </button>
                    </form>
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs font-medium text-red-600 hover:underline">刪除</button>
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
