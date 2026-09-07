"use client";

import { useRef, useState } from "react";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SubmitButton } from "@/components/SubmitButton";

export interface ServiceBookingField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "select" | "checkbox" | "consent";
  required: boolean;
  options: string[];
}
export interface ServiceItem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  price: number;
  duration_minutes: number | null;
  buffer_minutes: number;
  booking_target: "provider_required" | "provider_optional" | "resource_only";
  booking_fields: ServiceBookingField[];
  active: boolean;
}
type Action = (fd: FormData) => Promise<void>;

function targetLabel(target: ServiceItem["booking_target"]): string {
  if (target === "resource_only") return "場地／設備";
  if (target === "provider_optional") return "可指定或自動安排";
  return "必須指定服務提供者";
}

export default function ServiceManager({ items, createAction, updateAction, toggleAction, deleteAction }: {
  items: ServiceItem[];
  createAction: Action;
  updateAction: Action;
  toggleAction: Action;
  deleteAction: Action;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [duration, setDuration] = useState("30");
  const [buffer, setBuffer] = useState("0");
  const [target, setTarget] = useState<ServiceItem["booking_target"]>("provider_required");
  const [fields, setFields] = useState<ServiceBookingField[]>([]);
  const [showFields, setShowFields] = useState(false);

  function revealForm() {
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function start(item: ServiceItem) {
    setEditing(item);
    setName(item.name);
    setCategory(item.category ?? "");
    setDescription(item.description ?? "");
    setPrice(String(item.price ?? 0));
    setDuration(String(item.duration_minutes ?? 30));
    setBuffer(String(item.buffer_minutes ?? 0));
    setTarget(item.booking_target ?? "provider_required");
    setFields(item.booking_fields ?? []);
    setShowFields(Boolean(item.booking_fields?.length));
    revealForm();
  }

  function reset() {
    setEditing(null);
    setName("");
    setCategory("");
    setDescription("");
    setPrice("0");
    setDuration("30");
    setBuffer("0");
    setTarget("provider_required");
    setFields([]);
    setShowFields(false);
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2 className="font-semibold text-slate-900">服務項目</h2>
          <p className="mt-0.5 text-xs text-slate-500">服務時間加上緩衝時間，會共同占用排班與資源容量。</p>
        </div>
        <span className="text-xs tabular-nums text-slate-500">{items.length} 筆</span>
      </div>

      <form ref={formRef} action={editing ? updateAction : createAction} className={`grid scroll-mt-24 gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-6 ${editing ? "bg-brand-50/40" : "bg-white"}`}>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <input type="hidden" name="booking_fields" value={JSON.stringify(fields)} />
        <div className="sm:col-span-2 lg:col-span-6">
          <p className="text-sm font-semibold text-slate-800">{editing ? `編輯服務：${editing.name}` : "建立新服務"}</p>
          <p className="mt-0.5 text-xs text-slate-500">先填寫基本內容；顧客專用欄位可視需要展開設定。</p>
        </div>
        <label className="text-sm sm:col-span-2 lg:col-span-2"><span className="label">服務名稱</span><input name="name" required className="input" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="text-sm"><span className="label">分類</span><input name="category" className="input" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如：私人課" /></label>
        <label className="text-sm"><span className="label">基本售價</span><input name="price" type="number" min="0" max="1000000" required className="input" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        <label className="text-sm"><span className="label">服務時間（分鐘）</span><input name="duration_minutes" type="number" min="1" required className="input" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
        <label className="text-sm"><span className="label">緩衝時間（分鐘）</span><input name="buffer_minutes" type="number" min="0" required className="input" value={buffer} onChange={(event) => setBuffer(event.target.value)} /></label>
        <label className="text-sm sm:col-span-2 lg:col-span-2"><span className="label">預約方式</span><select name="booking_target" className="input" value={target} onChange={(event) => setTarget(event.target.value as ServiceItem["booking_target"])}><option value="provider_required">顧客必須選服務提供者</option><option value="provider_optional">可指定或由系統安排</option><option value="resource_only">只使用場地／設備</option></select></label>
        <label className="text-sm sm:col-span-2 lg:col-span-4"><span className="label">服務說明（選填）</span><input name="description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="sm:col-span-2 lg:col-span-6">
          <button type="button" className="flex min-h-11 w-full items-center justify-between border-y border-slate-200 bg-slate-50 px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100" aria-expanded={showFields} onClick={() => setShowFields((value) => !value)}>
            <span>顧客預約表單欄位</span><span className="text-xs text-slate-500">{fields.length} 個欄位 · {showFields ? "收合" : "展開設定"}</span>
          </button>
          {showFields && <BookingFieldBuilder fields={fields} onChange={setFields} />}
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
          <SubmitButton className="btn btn-primary">{editing ? "儲存服務修改" : "建立服務"}</SubmitButton>
          {editing && <button type="button" className="btn btn-secondary" onClick={reset}>取消編輯</button>}
        </div>
      </form>

      <div className="admin-table-shell admin-table-mobile-cards border-0">
        <table className="tbl">
          <thead><tr><th>服務</th><th>分類／售價</th><th>預約方式</th><th>時間占用</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未建立服務</td></tr> : items.map((item) => (
              <tr key={item.id} className={editing?.id === item.id ? "bg-brand-50/60" : ""}>
                <td data-label="服務"><div className="font-medium text-slate-800">{item.name}</div><div className="max-w-md text-xs text-slate-500">{item.description || "未填寫服務說明"}</div></td>
                <td data-label="分類／售價">{item.category || "未分類"}<div className="text-xs tabular-nums text-slate-500">NT${Number(item.price ?? 0).toLocaleString("zh-TW")}</div></td>
                <td data-label="預約方式">{targetLabel(item.booking_target)}</td>
                <td data-label="時間占用">{item.duration_minutes ?? 30} 分鐘 + 緩衝 {item.buffer_minutes} 分鐘{item.booking_fields?.length ? <div className="text-xs text-slate-500">另有 {item.booking_fields.length} 個表單欄位</div> : null}</td>
                <td data-label="狀態"><span className={`badge ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.active ? "啟用" : "停用"}</span></td>
                <td data-label="操作">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="admin-inline-action text-brand-700" onClick={() => start(item)}>編輯服務</button>
                    <form action={toggleAction}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="active" value={String(item.active)} /><SubmitButton className="admin-inline-action">{item.active ? "停用服務" : "啟用服務"}</SubmitButton></form>
                    <form action={deleteAction}><input type="hidden" name="id" value={item.id} /><ConfirmSubmitButton confirmMessage={`確定刪除「${item.name}」？若已有預約或相關紀錄，系統可能會拒絕刪除；一般情況建議改用停用。`} className="admin-inline-action text-red-700">刪除服務</ConfirmSubmitButton></form>
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

  return (
    <div className="border-b border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-xs leading-5 text-slate-500">這些欄位會顯示在顧客預約流程；同意條款會強制勾選，送出時會保存當下文字。</p>
        <button type="button" onClick={add} disabled={fields.length >= 20} className="btn btn-secondary min-h-11 shrink-0 disabled:opacity-50">新增表單欄位</button>
      </div>
      {fields.length === 0 ? <p className="mt-3 border-y border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">目前使用標準預約資料，不需額外填寫欄位。</p> : (
        <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {fields.map((field, index) => (
            <div key={`${field.key}-${index}`} className="grid gap-2 px-3 py-3 sm:grid-cols-2 lg:grid-cols-12">
              <label className="text-xs lg:col-span-4"><span className="label">顧客看到的標題</span><input className="input h-10 py-1 text-sm" value={field.label} onChange={(event) => patch(index, { label: event.target.value })} placeholder={field.type === "consent" ? "我已閱讀並同意取消政策" : "例如：本次服務需求"} required /></label>
              <label className="text-xs lg:col-span-2"><span className="label">欄位代碼</span><input className="input h-10 py-1 text-xs" value={field.key} onChange={(event) => patch(index, { key: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} pattern="[a-zA-Z][a-zA-Z0-9_]{0,63}" required /></label>
              <label className="text-xs lg:col-span-3"><span className="label">欄位類型</span><select className="input h-10 py-1 text-xs" value={field.type} onChange={(event) => { const type = event.target.value as ServiceBookingField["type"]; patch(index, { type, required: type === "consent" ? true : field.required, options: type === "select" ? field.options : [] }); }}><option value="text">單行文字</option><option value="textarea">多行文字</option><option value="date">日期</option><option value="select">下拉選單</option><option value="checkbox">一般勾選</option><option value="consent">同意條款（必填）</option></select></label>
              <label className="flex min-h-10 items-center gap-2 text-xs text-slate-600 lg:col-span-1"><input type="checkbox" checked={field.type === "consent" || field.required} disabled={field.type === "consent"} onChange={(event) => patch(index, { required: event.target.checked })} />必填</label>
              <div className="flex items-end justify-end gap-1 lg:col-span-2"><button type="button" className="min-h-10 rounded border border-slate-200 px-2 text-xs" onClick={() => move(index, -1)}>上移</button><button type="button" className="min-h-10 rounded border border-slate-200 px-2 text-xs" onClick={() => move(index, 1)}>下移</button><button type="button" className="min-h-10 rounded border border-red-200 px-3 text-xs text-red-700" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>移除欄位</button></div>
              {field.type === "select" && <label className="text-xs sm:col-span-2 lg:col-span-12"><span className="label">選項（每行或逗號分隔）</span><textarea className="input min-h-20 text-sm" value={field.options.join("\n")} onChange={(event) => patch(index, { options: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 30) })} required /></label>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
