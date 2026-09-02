import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";
import { createServiceAction, updateServiceAction, toggleServiceAction, deleteServiceAction } from "../service-actions";
import ServiceManager, { type ServiceItem } from "./ServiceManager";
import { ServiceAddonManager, type ServiceAddon } from "./ServiceAddonManager";
import { createServiceAddonAction, toggleServiceAddonAction, updateServiceAddonAction } from "./addon-actions";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  const [{ data, error }, { data: addonData, error: addonError }] = await Promise.all([
    supabase.from("services").select("id, name, category, description, duration_minutes, buffer_minutes, booking_target, booking_fields, active").eq("clinic_id", clinicId).order("created_at"),
    supabase.from("service_addons").select("id, service_id, name, description, duration_minutes, price, active").eq("clinic_id", clinicId).order("sort_order").order("created_at"),
  ]);
  if (error || addonError) throw new Error(error?.message ?? addonError?.message ?? "讀取服務設定失敗");
  const services = (data ?? []) as ServiceItem[];
  const addons = (addonData ?? []) as ServiceAddon[];
  return <div className="space-y-8"><div><h1 className="text-xl font-bold text-slate-900">服務與資源</h1><p className="text-sm text-slate-400">管理品牌提供的服務、預約表單、同意欄位與可選加購。</p></div><ServiceManager items={services} createAction={createServiceAction} updateAction={updateServiceAction} toggleAction={toggleServiceAction} deleteAction={deleteServiceAction} /><ServiceAddonManager services={services} addons={addons} createAction={createServiceAddonAction} updateAction={updateServiceAddonAction} toggleAction={toggleServiceAddonAction} /></div>;
}
