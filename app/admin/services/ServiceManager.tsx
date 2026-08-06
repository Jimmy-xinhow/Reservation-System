"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export interface ServiceItem { id: string; name: string; category: string | null; description: string | null; duration_minutes: number | null; buffer_minutes: number; active: boolean; }
type Action = (fd: FormData) => Promise<void>;

export default function ServiceManager({ items, createAction, updateAction, toggleAction, deleteAction }: { items: ServiceItem[]; createAction: Action; updateAction: Action; toggleAction: Action; deleteAction: Action }) {
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("30");
  const [buffer, setBuffer] = useState("0");
  function start(item: ServiceItem) { setEditing(item); setName(item.name); setCategory(item.category ?? ""); setDescription(item.description ?? ""); setDuration(String(item.duration_minutes ?? 30)); setBuffer(String(item.buffer_minutes ?? 0)); }
  function reset() { setEditing(null); setName(""); setCategory(""); setDescription(""); setDuration("30"); setBuffer("0"); }
  return <section className="space-y-3">
    <div><h2 className="font-semibold text-slate-900">服務項目</h2><p className="mt-1 text-sm text-slate-500">時長與緩衝會直接影響可預約時段與容量判定。</p></div>
    <form action={editing ? updateAction : createAction} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <label className="text-sm lg:col-span-2"><span className="label">服務名稱</span><input name="name" required className="input" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="text-sm"><span className="label">分類</span><input name="category" className="input" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="一般／進階" /></label>
      <label className="text-sm"><span className="label">服務分鐘</span><input name="duration_minutes" type="number" min="1" required className="input" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
      <label className="text-sm"><span className="label">緩衝分鐘</span><input name="buffer_minutes" type="number" min="0" required className="input" value={buffer} onChange={(event) => setBuffer(event.target.value)} /></label>
      <label className="text-sm sm:col-span-2 lg:col-span-4"><span className="label">說明</span><input name="description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="flex items-end gap-2 lg:col-span-2"><SubmitButton className="btn btn-primary">{editing ? "儲存服務" : "新增服務"}</SubmitButton>{editing && <button type="button" className="btn btn-secondary" onClick={reset}>取消</button>}</div>
    </form>
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>服務</th><th>分類</th><th>預約佔用</th><th>狀態</th><th>操作</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-slate-400">尚未建立服務。</td></tr> : items.map((item) => <tr key={item.id}><td><div className="font-medium text-slate-800">{item.name}</div><div className="text-xs text-slate-400">{item.description || "—"}</div></td><td>{item.category || "—"}</td><td>{item.duration_minutes ?? 30} 分鐘 + 緩衝 {item.buffer_minutes} 分鐘</td><td><span className={`badge ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.active ? "啟用" : "停用"}</span></td><td><div className="flex gap-3"><button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => start(item)}>編輯</button><form action={toggleAction}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="active" value={String(item.active)} /><SubmitButton className="text-xs font-medium text-slate-600 hover:underline">{item.active ? "停用" : "啟用"}</SubmitButton></form><form action={deleteAction}><input type="hidden" name="id" value={item.id} /><SubmitButton className="text-xs font-medium text-red-600 hover:underline">刪除</SubmitButton></form></div></td></tr>)}</tbody></table></div>
  </section>;
}

