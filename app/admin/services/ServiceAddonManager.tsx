"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

interface ServiceOption { id: string; name: string; active: boolean; }
export interface ServiceAddon { id: string; service_id: string; name: string; description: string | null; duration_minutes: number; price: number; active: boolean; }
type Action = (fd: FormData) => Promise<void>;

export function ServiceAddonManager({ services, addons, createAction, updateAction, toggleAction }: {
  services: ServiceOption[];
  addons: ServiceAddon[];
  createAction: Action;
  updateAction: Action;
  toggleAction: Action;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<ServiceAddon | null>(null);
  const nameById = new Map(services.map((service) => [service.id, service.name]));

  function startEdit(addon: ServiceAddon) {
    setEditing(addon);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div><h2 className="font-semibold text-slate-900">服務加購</h2><p className="mt-0.5 text-xs text-slate-500">加購時間會納入可預約時段計算，價格則保存在預約紀錄中供櫃檯結帳。</p></div>
        <span className="text-xs tabular-nums text-slate-500">{addons.length} 筆</span>
      </div>
      <form key={editing?.id ?? "new-addon"} ref={formRef} action={editing ? updateAction : createAction} className={`grid scroll-mt-24 gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-6 ${editing ? "bg-brand-50/40" : "bg-white"}`}>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <div className="sm:col-span-2 lg:col-span-6"><p className="text-sm font-semibold text-slate-800">{editing ? `編輯加購：${editing.name}` : "建立加購項目"}</p></div>
        <label className="text-sm lg:col-span-2"><span className="label">主服務</span><select name="service_id" className="input" required defaultValue={editing?.service_id ?? ""} disabled={Boolean(editing)}><option value="" disabled>請選擇服務</option>{services.filter((service) => service.active || service.id === editing?.service_id).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>{editing && <input type="hidden" name="service_id" value={editing.service_id} />}</label>
        <label className="text-sm lg:col-span-2"><span className="label">加購名稱</span><input name="name" className="input" maxLength={120} required defaultValue={editing?.name ?? ""} placeholder="例如：延長諮詢" /></label>
        <label className="text-sm"><span className="label">增加時間（分鐘）</span><input name="duration_minutes" type="number" min={0} max={480} defaultValue={editing?.duration_minutes ?? 0} className="input" required /></label>
        <label className="text-sm"><span className="label">加購價格</span><input name="price" type="number" min={0} max={1000000} defaultValue={editing?.price ?? 0} className="input" required /></label>
        <label className="text-sm sm:col-span-2 lg:col-span-5"><span className="label">加購說明（選填）</span><input name="description" className="input" maxLength={500} defaultValue={editing?.description ?? ""} /></label>
        <div className="flex flex-wrap items-end gap-2"><SubmitButton className="btn btn-primary">{editing ? "儲存加購修改" : "建立加購"}</SubmitButton>{editing && <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>取消編輯</button>}</div>
      </form>
      <div className="admin-table-shell admin-table-mobile-cards border-0">
        <table className="tbl">
          <thead><tr><th>加購項目</th><th>主服務</th><th>增加時間</th><th>價格</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>
            {addons.length === 0 ? <tr><td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未建立加購項目</td></tr> : addons.map((addon) => (
              <tr key={addon.id} className={editing?.id === addon.id ? "bg-brand-50/60" : ""}>
                <td data-label="加購項目"><span className="font-medium text-slate-800">{addon.name}</span><div className="max-w-md text-xs text-slate-500">{addon.description || "未填寫說明"}</div></td>
                <td data-label="主服務">{nameById.get(addon.service_id) ?? "已停用服務"}</td>
                <td data-label="增加時間">{addon.duration_minutes} 分鐘</td>
                <td data-label="價格" className="tabular-nums">NT${addon.price.toLocaleString("zh-TW")}</td>
                <td data-label="狀態"><span className={`badge ${addon.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{addon.active ? "啟用" : "停用"}</span></td>
                <td data-label="操作"><div className="flex flex-wrap gap-1"><button type="button" className="admin-inline-action text-brand-700" onClick={() => startEdit(addon)}>編輯加購</button><form action={toggleAction}><input type="hidden" name="id" value={addon.id} /><input type="hidden" name="active" value={String(addon.active)} /><SubmitButton className="admin-inline-action">{addon.active ? "停用加購" : "啟用加購"}</SubmitButton></form></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
