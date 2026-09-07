import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import ResourceManager, { type ResourceAssignment, type ResourceItem } from "./ResourceManager";
import { assignResourceAction, createResourceAction, removeAssignmentAction, toggleResourceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const { clinicId } = await requireAdmin();
  const service = createServiceClient();
  const [{ data: resources, error: resourcesError }, { data: services, error: servicesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    service.from("service_resources").select("id, name, kind, capacity, active").eq("clinic_id", clinicId).order("name"),
    service.from("services").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("service_resource_assignments").select("id, service_id, resource_id, quantity, services(name), service_resources(name)").eq("clinic_id", clinicId).order("created_at"),
  ]);
  const firstError = resourcesError ?? servicesError ?? assignmentsError;
  if (firstError) throw new Error(`讀取預約資源失敗：${firstError.message}`);
  const assignmentRows = ((assignments ?? []) as unknown as Array<{ id: string; service_id: string; resource_id: string; quantity: number; services: { name: string } | { name: string }[] | null; service_resources: { name: string } | { name: string }[] | null }>).map((row) => {
    const serviceName = Array.isArray(row.services) ? row.services[0]?.name : row.services?.name;
    const resourceName = Array.isArray(row.service_resources) ? row.service_resources[0]?.name : row.service_resources?.name;
    return { id: row.id as string, service_id: row.service_id as string, resource_id: row.resource_id as string, quantity: row.quantity as number, service_name: serviceName ?? "未知服務", resource_name: resourceName ?? "未知資源" };
  }) as ResourceAssignment[];
  const resourceRows = (resources ?? []) as ResourceItem[];
  const activeResources = resourceRows.filter((resource) => resource.active);
  const totalCapacity = activeResources.reduce((total, resource) => total + resource.capacity, 0);

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">預約資源</p>
          <h1 className="admin-page-title">場地與設備資源</h1>
          <p className="admin-page-description">管理教室、房間與器材的可用數量，避免不同服務預約到同一個資源。</p>
        </div>
      </header>

      <section className="admin-metric-strip grid-cols-3" aria-label="資源摘要">
        <div className="admin-metric"><span className="admin-metric-label">啟用資源</span><strong className="admin-metric-value">{activeResources.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">可用總量</span><strong className="admin-metric-value">{totalCapacity}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">服務綁定</span><strong className="admin-metric-value">{assignmentRows.length}</strong></div>
      </section>

      <ResourceManager
        resources={resourceRows}
        services={(services ?? []) as Array<{ id: string; name: string }>}
        assignments={assignmentRows}
        createAction={createResourceAction}
        toggleAction={toggleResourceAction}
        assignAction={assignResourceAction}
        removeAction={removeAssignmentAction}
      />
    </div>
  );
}
