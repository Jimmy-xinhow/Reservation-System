import { requireNonProvider } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import ResourceManager, { type ResourceAssignment, type ResourceItem } from "./ResourceManager";
import { assignResourceAction, createResourceAction, removeAssignmentAction, toggleResourceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const { clinicId } = await requireNonProvider();
  const service = createServiceClient();
  const [{ data: resources }, { data: services }, { data: assignments }] = await Promise.all([
    service.from("service_resources").select("id, name, kind, capacity, active").eq("clinic_id", clinicId).order("name"),
    service.from("services").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("service_resource_assignments").select("id, service_id, resource_id, quantity, services(name), service_resources(name)").eq("clinic_id", clinicId).order("created_at"),
  ]);
  const assignmentRows = ((assignments ?? []) as unknown as Array<{ id: string; service_id: string; resource_id: string; quantity: number; services: { name: string } | { name: string }[] | null; service_resources: { name: string } | { name: string }[] | null }>).map((row) => {
    const serviceName = Array.isArray(row.services) ? row.services[0]?.name : row.services?.name;
    const resourceName = Array.isArray(row.service_resources) ? row.service_resources[0]?.name : row.service_resources?.name;
    return { id: row.id as string, service_id: row.service_id as string, resource_id: row.resource_id as string, quantity: row.quantity as number, service_name: serviceName ?? "未知服務", resource_name: resourceName ?? "未知資源" };
  }) as ResourceAssignment[];
  return <div className="space-y-6"><div><p className="eyebrow">Resources</p><h1 className="text-xl font-bold text-slate-900">場地與設備資源</h1><p className="mt-1 text-sm text-slate-500">集中管理可被服務預約占用的場地、設備與人員資源。</p></div><ResourceManager resources={(resources ?? []) as ResourceItem[]} services={(services ?? []) as Array<{ id: string; name: string }>} assignments={assignmentRows} createAction={createResourceAction} toggleAction={toggleResourceAction} assignAction={assignResourceAction} removeAction={removeAssignmentAction} /></div>;
}
