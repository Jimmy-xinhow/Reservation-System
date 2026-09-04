"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export interface ServiceBookingField { key: string; label: string; type: "text" | "textarea" | "date" | "select" | "checkbox" | "consent"; required: boolean; options: string[]; }
export interface ServiceItem { id: string; name: string; category: string | null; description: string | null; price: number; duration_minutes: number | null; buffer_minutes: number; booking_target: "provider_required" | "provider_optional" | "resource_only"; booking_fields: ServiceBookingField[]; active: boolean; }
type Action = (fd: FormData) => Promise<void>;

export default function ServiceManager({ items, createAction, updateAction, toggleAction, deleteAction }: { items: ServiceItem[]; createAction: Action; updateAction: Action; toggleAction: Action; deleteAction: Action }) {
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [duration, setDuration] = useState("30");
  const [buffer, setBuffer] = useState("0");
  const [target, setTarget] = useState<ServiceItem["booking_target"]>("provider_required");
  const [fields, setFields] = useState<ServiceBookingField[]>([]);
  function start(item: ServiceItem) { setEditing(item); setName(item.name); setCategory(item.category ?? ""); setDescription(item.description ?? ""); setPrice(String(item.price ?? 0)); setDuration(String(item.duration_minutes ?? 30)); setBuffer(String(item.buffer_minutes ?? 0)); setTarget(item.booking_target ?? "provider_required"); setFields(item.booking_fields ?? []); }
  function reset() { setEditing(null); setName(""); setCategory(""); setDescription(""); setPrice("0"); setDuration("30"); setBuffer("0"); setTarget("provider_required"); setFields([]); }
  return <section className="space-y-3">
    <div><h2 className="font-semibold text-slate-900">服務項目</h2><p className="mt-1 text-sm text-slate-500">時長與緩衝會直接影響可預約時段與容量判定。</p></div>
    <form action={editing ? updateAction : createAction} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <input type="hidden" name="booking_fields" value={JSON.stringify(fields)} />
      <label className="text-sm lg:col-span-2"><span className="label">服務名稱</span><input name="name" required className="input" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="text-sm"><span className="label">分類</span><input name="category" className="input" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="一般／進階" /></label>
      <label className="text-sm"><span className="label">基本售價（TWD）</span><input name="price" type="number" min="0" max="1000000" required className="input" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
      <label className="text-sm"><span className="label">服務分鐘</span><input name="duration_minutes" type="number" min="1" required className="input" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
      <label className="text-sm"><span className="label">緩衝分鐘</span><input name="buffer_minutes" type="number" min="0" required className="input" value={buffer} onChange={(event) => setBuffer(event.target.value)} /></label>
      <label className="text-sm sm:col-span-2"><span className="label">預約目標</span><select name="booking_target" className="input" value={target} onChange={(event) => setTarget(event.target.value as ServiceItem["booking_target"])}><option value="provider_required">必須選服務提供者</option><option value="provider_optional">可指定或由系統安排</option><option value="resource_only">只使用場地／設備資源</option></select></label>
      <label className="text-sm sm:col-span-2 lg:col-span-4"><span className="label">說明</span><input name="description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="sm:col-span-2 lg:col-span-6"><BookingFieldBuilder fields={fields} onChange={setFields} /></div>
      <div className="flex items-end gap-2 lg:col-span-2"><SubmitButton className="btn btn-primary">{editing ? "儲存服務" : "新增服務"}</SubmitButton>{editing && <button type="button" className="btn btn-secondary" onClick={reset}>取消</button>}</div>
    </form>
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>服務</th><th>分類</th><th>基本售價</th><th>預約目標</th><th>預約佔用</th><th>狀態</th><th>操作</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-slate-400">尚未建立服務。</td></tr> : items.map((item) => <tr key={item.id}><td><div className="font-medium text-slate-800">{item.name}</div><div className="text-xs text-slate-400">{item.description || "—"}</div></td><td>{item.category || "—"}</td><td>NT${Number(item.price ?? 0).toLocaleString("zh-TW")}</td><td>{item.booking_target === "resource_only" ? "場地／設備" : item.booking_target === "provider_optional" ? "可指定或自動安排" : "服務提供者"}</td><td>{item.duration_minutes ?? 30} 分鐘 + 緩衝 {item.buffer_minutes} 分鐘{item.booking_fields?.length ? ` · ${item.booking_fields.length} 個自訂欄位` : ""}</td><td><span className={`badge ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.active ? "啟用" : "停用"}</span></td><td><div className="flex flex-wrap gap-1"><button type="button" className="admin-inline-action text-brand-700" onClick={() => start(item)}>編輯</button><form action={toggleAction}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="active" value={String(item.active)} /><SubmitButton className="admin-inline-action">{item.active ? "停用" : "啟用"}</SubmitButton></form><form action={deleteAction}><input type="hidden" name="id" value={item.id} /><SubmitButton className="admin-inline-action text-red-700">刪除</SubmitButton></form></div></td></tr>)}</tbody></table></div>
  </section>;
}

function BookingFieldBuilder({ fields, onChange }: { fields: ServiceBookingField[]; onChange: (fields: ServiceBookingField[]) => void }) {
  const add = () => onChange([...fields, { key: `field_${Date.now().toString(36)}`, label: "", type: "text", required: false, options: [] }]);
  const patch = (index: number, value: Partial<ServiceBookingField>) => onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...value } : field));
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-slate-800">預約表單與同意欄位</p><p className="mt-1 text-xs leading-5 text-slate-500">直接建立顧客要填的欄位；「同意條款」會強制勾選，預約時保存欄位文字快照。</p></div><button type="button" onClick={add} disabled={fields.length >= 20} className="btn btn-secondary min-h-11 shrink-0 disabled:opacity-50">＋ 新增欄位</button></div>{fields.length === 0 ? <p className="mt-4 rounded-lg bg-white px-3 py-4 text-center text-xs text-slate-400">尚未設定額外欄位。</p> : <div className="mt-4 space-y-3">{fields.map((field, index) => <div key={`${field.key}-${index}`} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-12"><label className="text-xs lg:col-span-4"><span className="label">顧客看到的標題</span><input className="input h-10 py-1 text-sm" value={field.label} onChange={(event) => patch(index, { label: event.target.value })} placeholder={field.type === "consent" ? "我已閱讀並同意取消政策" : "例如：本次服務需求"} required /></label><label className="text-xs lg:col-span-2"><span className="label">欄位代碼</span><input className="input h-10 py-1 text-xs" value={field.key} onChange={(event) => patch(index, { key: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} pattern="[a-zA-Z][a-zA-Z0-9_]{0,63}" required /></label><label className="text-xs lg:col-span-3"><span className="label">欄位類型</span><select className="input h-10 py-1 text-xs" value={field.type} onChange={(event) => { const type = event.target.value as ServiceBookingField["type"]; patch(index, { type, required: type === "consent" ? true : field.required, options: type === "select" ? field.options : [] }); }}><option value="text">單行文字</option><option value="textarea">多行文字</option><option value="date">日期</option><option value="select">下拉選單</option><option value="checkbox">一般勾選</option><option value="consent">同意條款（必填）</option></select></label><label className="flex min-h-10 items-center gap-2 text-xs text-slate-600 lg:col-span-1"><input type="checkbox" checked={field.type === "consent" || field.required} disabled={field.type === "consent"} onChange={(event) => patch(index, { required: event.target.checked })} />必填</label><div className="flex items-end justify-end gap-1 lg:col-span-2"><button type="button" className="min-h-10 min-w-10 rounded-lg border border-slate-200 text-xs" onClick={() => move(index, -1)} aria-label="上移欄位">↑</button><button type="button" className="min-h-10 min-w-10 rounded-lg border border-slate-200 text-xs" onClick={() => move(index, 1)} aria-label="下移欄位">↓</button><button type="button" className="min-h-10 rounded-lg border border-red-200 px-3 text-xs text-red-700" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>移除</button></div>{field.type === "select" && <label className="text-xs sm:col-span-2 lg:col-span-12"><span className="label">選項（每行或逗號分隔）</span><textarea className="input min-h-20 text-sm" value={field.options.join("\n")} onChange={(event) => patch(index, { options: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 30) })} required /></label>}</div>)}</div>}</div>;
}
