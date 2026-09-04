"use client";

import { SubmitButton } from "@/components/SubmitButton";

export interface ResourceItem { id: string; name: string; kind: string; capacity: number; active: boolean; }
export interface ResourceAssignment { id: string; service_id: string; resource_id: string; quantity: number; service_name: string; resource_name: string; }
type Action = (formData: FormData) => void | Promise<void>;

const kindLabel: Record<string, string> = { room: "場地", equipment: "設備", staff: "人員", other: "其他" };

export default function ResourceManager({ resources, services, assignments, createAction, toggleAction, assignAction, removeAction }: {
  resources: ResourceItem[];
  services: Array<{ id: string; name: string }>;
  assignments: ResourceAssignment[];
  createAction: Action;
  toggleAction: Action;
  assignAction: Action;
  removeAction: Action;
}) {
  return <div className="space-y-6">
    <section className="card p-5">
      <h2 className="font-semibold text-slate-900">新增場地／設備資源</h2>
      <p className="mt-1 text-sm text-slate-500">將會套用到服務預約的同時段容量控管；停用後不再提供新預約。</p>
      <form action={createAction} className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="text-sm"><span className="label">資源名稱</span><input className="input" name="name" placeholder="例如：一號諮詢室" required /></label>
        <label className="text-sm"><span className="label">資源類型</span><select className="input" name="kind" defaultValue="room"><option value="room">場地</option><option value="equipment">設備</option><option value="staff">人員</option><option value="other">其他</option></select></label>
        <label className="text-sm"><span className="label">同時可用數量</span><input className="input" name="capacity" type="number" min="1" defaultValue="1" /><span className="help-text block">例如有兩間相同教室，可填 2。</span></label>
        <SubmitButton className="btn btn-primary self-end">建立資源</SubmitButton>
      </form>
    </section>

    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">資源清單</h2></div>
      <div className="divide-y divide-slate-100">
        {resources.length === 0 ? <p className="p-5 text-sm text-slate-400">尚未建立資源。</p> : resources.map((resource) => <div key={resource.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div><p className="font-medium text-slate-800">{resource.name}</p><p className="text-xs text-slate-500">{kindLabel[resource.kind] ?? "其他"} · 同時可用 {resource.capacity}</p></div>
          <form action={toggleAction}><input type="hidden" name="id" value={resource.id} /><input type="hidden" name="active" value={String(resource.active)} /><SubmitButton className={`inline-action text-sm ${resource.active ? "text-amber-700" : "text-emerald-700"}`}>{resource.active ? "停用" : "啟用"}</SubmitButton></form>
        </div>)}
      </div>
    </section>

    <section className="card p-5">
      <h2 className="font-semibold text-slate-900">服務資源綁定</h2>
      <p className="mt-1 text-sm text-slate-500">指定每次預約會占用哪些場地或設備，系統會一起檢查剩餘數量。</p>
      <form action={assignAction} className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="text-sm"><span className="label">服務</span><select className="input" name="service_id" required defaultValue=""><option value="" disabled>請選擇</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <label className="text-sm"><span className="label">要占用的資源</span><select className="input" name="resource_id" required defaultValue=""><option value="" disabled>請選擇</option>{resources.filter((resource) => resource.active).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
        <label className="text-sm"><span className="label">每次占用數量</span><input className="input" name="quantity" type="number" min="1" defaultValue="1" /></label>
        <SubmitButton className="btn btn-primary self-end">儲存綁定</SubmitButton>
      </form>
      <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
        {assignments.length === 0 ? <p className="py-5 text-sm text-slate-500">尚未設定服務資源綁定。</p> : assignments.map((assignment) => <div key={assignment.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{assignment.service_name} → {assignment.resource_name} × {assignment.quantity}</span><form action={removeAction}><input type="hidden" name="id" value={assignment.id} /><SubmitButton className="admin-inline-action text-red-700">解除</SubmitButton></form></div>)}
      </div>
    </section>
  </div>;
}
