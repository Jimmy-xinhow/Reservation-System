import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";
import { createServiceAction, updateServiceAction, toggleServiceAction, deleteServiceAction } from "../service-actions";
import ServiceManager, { type ServiceItem } from "./ServiceManager";
import { ServiceAddonManager, type ServiceAddon } from "./ServiceAddonManager";
import { createServiceAddonAction, toggleServiceAddonAction, updateServiceAddonAction } from "./addon-actions";
import { ServiceSetupTabs } from "@/components/admin/ManagementTabs";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  const [{ data, error }, { data: addonData, error: addonError }] = await Promise.all([
    supabase.from("services").select("id, name, category, description, price, duration_minutes, buffer_minutes, booking_target, booking_fields, active").eq("clinic_id", clinicId).order("created_at"),
    supabase.from("service_addons").select("id, service_id, name, description, duration_minutes, price, active").eq("clinic_id", clinicId).order("sort_order").order("created_at"),
  ]);
  if (error || addonError) throw new Error(error?.message ?? addonError?.message ?? "讀取服務設定失敗");
  const services = (data ?? []) as ServiceItem[];
  const addons = (addonData ?? []) as ServiceAddon[];
  const activeServices = services.filter((service) => service.active);
  const resourceOnlyServices = activeServices.filter((service) => service.booking_target === "resource_only");
  const activeAddons = addons.filter((addon) => addon.active);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">營運中心</p>
          <h1 className="admin-page-title">服務方案與排程設定</h1>
          <p className="admin-page-description">從服務方案、人員資源、每週排程到例外日期，依頁籤完成整套可預約設定。</p>
        </div>
      </div>
      <ServiceSetupTabs active="services" />
      <div className="admin-metric-strip grid-cols-3">
        <div className="admin-metric"><span className="admin-metric-label">啟用服務</span><strong className="admin-metric-value">{activeServices.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">免指定人員</span><strong className="admin-metric-value">{resourceOnlyServices.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">啟用加購</span><strong className="admin-metric-value">{activeAddons.length}</strong></div>
      </div>
      <ServiceManager items={services} createAction={createServiceAction} updateAction={updateServiceAction} toggleAction={toggleServiceAction} deleteAction={deleteServiceAction} />
      <ServiceAddonManager services={services} addons={addons} createAction={createServiceAddonAction} updateAction={updateServiceAddonAction} toggleAction={toggleServiceAddonAction} />
    </div>
  );
}
