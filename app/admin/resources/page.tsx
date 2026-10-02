
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import ResourceManager, { type ResourceAssignment, type ResourceItem } from "./ResourceManager";
import { assignResourceAction, createResourceAction, removeAssignmentAction, toggleResourceAction } from "./actions";
import { ServiceSetupTabs } from "@/components/admin/ManagementTabs";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const { clinicId } = await requireAdmin();
  const service = createServiceClient();
  const [resources, services, assignments] = await Promise.all([
    fetchAllSupabasePages((from, to) => service.from("service_resources").select("id, name, kind, capacity, active").eq("clinic_id", clinicId).order("name").order("id").range(from, to)) as Promise<ResourceItem[]>,
    fetchAllSupabasePages((from, to) => service.from("services").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name").order("id").range(from, to)) as Promise<Array<{ id: string; name: string }>>,
    fetchAllSupabasePages((from, to) => service.from("service_resource_assignments").select("id, service_id, resource_id, quantity, services!service_resource_assignments_service_id_fkey(clinic_id, name), service_resources!service_resource_assignments_resource_id_fkey(clinic_id, name)").eq("clinic_id", clinicId).order("created_at").order("id").range(from, to)) as Promise<Array<{ id: string; service_id: string; resource_id: string; quantity: number; services: { clinic_id: string; name: string } | { clinic_id: string; name: string }[] | null; service_resources: { clinic_id: string; name: string } | { clinic_id: string; name: string }[] | null }>>,
  ]);
  const assignmentRows = assignments.map((row) => {
    const relatedService = Array.isArray(row.services) ? row.services[0] : row.services;
    const relatedResource = Array.isArray(row.service_resources) ? row.service_resources[0] : row.service_resources;
    const serviceName = relatedService?.clinic_id === clinicId ? relatedService.name : null;
    const resourceName = relatedResource?.clinic_id === clinicId ? relatedResource.name : null;
    return { id: row.id, service_id: row.service_id, resource_id: row.resource_id, quantity: row.quantity, service_name: serviceName ?? "未知服務", resource_name: resourceName ?? "未知資源" };
  }) as ResourceAssignment[];
  const resourceRows = resources;
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

      <ServiceSetupTabs active="resources" />

      <section className="admin-metric-strip grid-cols-3" aria-label="資源摘要">
        <div className="admin-metric"><span className="admin-metric-label">啟用資源</span><strong className="admin-metric-value">{activeResources.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">可用總量</span><strong className="admin-metric-value">{totalCapacity}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">服務綁定</span><strong className="admin-metric-value">{assignmentRows.length}</strong></div>
      </section>

      <ResourceManager
        resources={resourceRows}
        services={services}
        assignments={assignmentRows}
        createAction={createResourceAction}
        toggleAction={toggleResourceAction}
        assignAction={assignResourceAction}
        removeAction={removeAssignmentAction}
      />
    </div>
  );
}
