import { createSupabaseServer } from "@/lib/supabase-server";
import { requireNonProvider } from "@/lib/admin";
import { createServiceAction, updateServiceAction, toggleServiceAction, deleteServiceAction } from "../actions";
import ServiceManager, { type ServiceItem } from "./ServiceManager";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const { clinicId } = await requireNonProvider();
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("services").select("id, name, category, description, duration_minutes, buffer_minutes, active").eq("clinic_id", clinicId).order("created_at");
  const services = (data ?? []) as ServiceItem[];
  return <div className="space-y-6"><div><h1 className="text-xl font-bold text-slate-900">服務與資源</h1><p className="text-sm text-slate-400">管理品牌提供的服務、分類、實際服務分鐘與前後緩衝。</p></div><ServiceManager items={services} createAction={createServiceAction} updateAction={updateServiceAction} toggleAction={toggleServiceAction} deleteAction={deleteServiceAction} /></div>;
}
