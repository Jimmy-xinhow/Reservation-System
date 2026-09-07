"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

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
  const activeResources = resources.filter((resource) => resource.active);

  return <div className="space-y-5">
    <div className="admin-workbench-grid">
      <section className="admin-section">
        <div className="admin-section-header">
          <div><h2 className="font-semibold text-slate-900">新增資源</h2><p className="mt-0.5 text-xs text-slate-500">建立可被預約占用的空間或設備。</p></div>
        </div>
        <form action={createAction} className="grid gap-3 p-4 sm:grid-cols-2">
        <label className="text-sm"><span className="label">資源名稱</span><input className="input" name="name" placeholder="例如：一號諮詢室" required /></label>
        <label className="text-sm"><span className="label">資源類型</span><select className="input" name="kind" defaultValue="room"><option value="room">場地</option><option value="equipment">設備</option><option value="staff">人員</option><option value="other">其他</option></select></label>
        <label className="text-sm"><span className="label">同時可用數量</span><input className="input" name="capacity" type="number" min="1" defaultValue="1" /><span className="help-text block">例如有兩間相同教室，可填 2。</span></label>
        <div className="flex items-end"><SubmitButton className="btn btn-primary">建立資源</SubmitButton></div>
        </form>
      </section>

      <section className="admin-section">
        <div className="admin-section-header">
          <div><h2 className="font-semibold text-slate-900">綁定服務資源</h2><p className="mt-0.5 text-xs text-slate-500">設定每次預約必須占用的資源。</p></div>
        </div>
        <form action={assignAction} className="grid gap-3 p-4 sm:grid-cols-2">
        <label className="text-sm"><span className="label">服務</span><select className="input" name="service_id" required defaultValue=""><option value="" disabled>請選擇</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <label className="text-sm"><span className="label">要占用的資源</span><select className="input" name="resource_id" required defaultValue=""><option value="" disabled>請選擇</option>{activeResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
        <label className="text-sm"><span className="label">每次占用數量</span><input className="input" name="quantity" type="number" min="1" defaultValue="1" /></label>
        <div className="flex items-end"><SubmitButton className="btn btn-primary">儲存資源綁定</SubmitButton></div>
        </form>
      </section>
    </div>

    <div className="admin-workbench-grid">
      <section className="admin-section">
        <div className="admin-section-header"><h2 className="font-semibold text-slate-900">資源清單</h2><span className="text-xs tabular-nums text-slate-500">{resources.length} 項</span></div>
        <div className="admin-table-shell admin-table-mobile-cards border-0">
          <table className="tbl">
            <thead><tr><th>資源</th><th>類型</th><th>數量</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {resources.length === 0 && <tr><td colSpan={5} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未建立資源</td></tr>}
              {resources.map((resource) => <tr key={resource.id}>
                <td data-label="資源" className="font-medium text-slate-800">{resource.name}</td>
                <td data-label="類型">{kindLabel[resource.kind] ?? "其他"}</td>
                <td data-label="同時可用數量">{resource.capacity}</td>
                <td data-label="狀態"><span className={`badge ${resource.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>{resource.active ? "啟用" : "停用"}</span></td>
                <td data-label="操作"><form action={toggleAction}><input type="hidden" name="id" value={resource.id} /><input type="hidden" name="active" value={String(resource.active)} /><SubmitButton className="admin-inline-action">{resource.active ? "停用資源" : "啟用資源"}</SubmitButton></form></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-header"><h2 className="font-semibold text-slate-900">服務綁定清單</h2><span className="text-xs tabular-nums text-slate-500">{assignments.length} 組</span></div>
        <div className="admin-table-shell admin-table-mobile-cards border-0">
          <table className="tbl">
            <thead><tr><th>服務</th><th>占用資源</th><th>數量</th><th>操作</th></tr></thead>
            <tbody>
              {assignments.length === 0 && <tr><td colSpan={4} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未設定服務資源綁定</td></tr>}
              {assignments.map((assignment) => <tr key={assignment.id}>
                <td data-label="服務" className="font-medium text-slate-800">{assignment.service_name}</td>
                <td data-label="占用資源">{assignment.resource_name}</td>
                <td data-label="每次占用數量">{assignment.quantity}</td>
                <td data-label="操作"><form action={removeAction}><input type="hidden" name="id" value={assignment.id} /><ConfirmSubmitButton confirmMessage="解除後，新預約將不再檢查這項資源的剩餘數量。確定解除綁定嗎？" className="admin-inline-action text-red-700">解除資源綁定</ConfirmSubmitButton></form></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>;
}
