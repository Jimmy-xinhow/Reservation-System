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
        <input className="input" name="name" placeholder="例如：一號諮詢室" required />
        <select className="input" name="kind" defaultValue="room"><option value="room">場地</option><option value="equipment">設備</option><option value="staff">人員</option><option value="other">其他</option></select>
        <input className="input" name="capacity" type="number" min="1" defaultValue="1" aria-label="容量" />
        <SubmitButton className="btn btn-primary">建立資源</SubmitButton>
      </form>
    </section>

    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">資源清單</h2></div>
      <div className="divide-y divide-slate-100">
        {resources.length === 0 ? <p className="p-5 text-sm text-slate-400">尚未建立資源。</p> : resources.map((resource) => <div key={resource.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div><p className="font-medium text-slate-800">{resource.name}</p><p className="text-xs text-slate-500">{kindLabel[resource.kind] ?? resource.kind} · 容量 {resource.capacity}</p></div>
          <form action={toggleAction}><input type="hidden" name="id" value={resource.id} /><input type="hidden" name="active" value={String(resource.active)} /><SubmitButton className={`text-sm ${resource.active ? "text-amber-700" : "text-emerald-700"}`}>{resource.active ? "停用" : "啟用"}</SubmitButton></form>
        </div>)}
      </div>
    </section>

    <section className="card p-5">
      <h2 className="font-semibold text-slate-900">服務資源綁定</h2>
      <form action={assignAction} className="mt-4 grid gap-3 sm:grid-cols-4">
        <select className="input" name="service_id" required defaultValue=""><option value="" disabled>選擇服務</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
        <select className="input" name="resource_id" required defaultValue=""><option value="" disabled>選擇資源</option>{resources.filter((resource) => resource.active).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select>
        <input className="input" name="quantity" type="number" min="1" defaultValue="1" aria-label="每次預約占用數量" />
        <SubmitButton className="btn btn-primary">儲存綁定</SubmitButton>
      </form>
      <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
        {assignments.length === 0 ? <p className="py-5 text-sm text-slate-400">尚未設定服務資源綁定。</p> : assignments.map((assignment) => <div key={assignment.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{assignment.service_name} → {assignment.resource_name} × {assignment.quantity}</span><form action={removeAction}><input type="hidden" name="id" value={assignment.id} /><SubmitButton className="text-xs text-red-600">解除</SubmitButton></form></div>)}
      </div>
    </section>
  </div>;
}
