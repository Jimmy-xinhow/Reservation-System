import { getOptionalMember } from "@/lib/admin";
import { getOptionalPlatformAdmin } from "@/lib/platform";
import { platformAccessLabel } from "@/lib/platform-roles";
import { brandAccessLabel } from "@/lib/access-control";
import { headers } from "next/headers";
import { signOutAction, setActiveClinicAction } from "./actions";
import { Brand } from "@/components/Brand";
import { AdminNav } from "@/components/AdminNav";
import { SubmitButton } from "@/components/SubmitButton";
import { AdminProductTelemetry } from "@/components/AdminProductTelemetry";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [member, platformAdmin] = await Promise.all([getOptionalMember(), getOptionalPlatformAdmin()]);
  const currentPath = (await headers()).get("x-admin-path") ?? "";
  const isPlatformShell = Boolean(platformAdmin && currentPath.startsWith("/admin/platform"));
  const hasDualAdminContext = Boolean(member && platformAdmin);
  if (!member && !platformAdmin) return <>{children}</>;

  if (platformAdmin && (isPlatformShell || !member)) {
    return (
      <div className="admin-shell admin-shell-platform min-h-screen">
        <AdminNav role="owner" isPlatformAdmin platformAccessType={platformAdmin.accessType} platformPermissions={platformAdmin.permissions} hasBrandContext={Boolean(member)} />
        <div className="min-h-screen lg:pl-56">
          <header className="admin-topbar">
            <div className="admin-topbar-inner">
              <div className="admin-wordmark">
                <div className="admin-wordmark-mark" aria-hidden="true">XP</div>
                <div className="min-w-0">
                  <div className="admin-wordmark-title">XINHOW PLATFORM</div>
                  <div className="admin-wordmark-subtitle">跨品牌營運控制台</div>
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                <span className="badge hidden bg-emerald-50 text-emerald-800 md:inline-flex">{platformAccessLabel(platformAdmin.accessType)}</span>
                {hasDualAdminContext && (
                  <a href="/admin/dashboard" className="btn btn-secondary min-h-10 shrink-0 whitespace-nowrap px-3 py-1.5 text-xs">
                    <span className="sm:hidden">品牌後台</span><span className="hidden sm:inline">返回品牌後台</span>
                  </a>
                )}
                <form action={signOutAction}><SubmitButton className="btn btn-ghost min-h-10 shrink-0 px-2.5 py-1.5 text-sm sm:px-3">登出</SubmitButton></form>
              </div>
            </div>
          </header>
          <main className="admin-content">{children}</main>
        </div>
      </div>
    );
  }
  if (!member) return <>{children}</>;

  const { data: moduleSettings, error: moduleSettingsError } = await member.supabase
    .from("clinic_settings")
    .select("events_enabled, memberships_enabled, crm_automation_enabled, line_channel_enabled, legacy_progress_enabled, beauty_operations_enabled")
    .eq("clinic_id", member.clinicId)
    .maybeSingle();
  if (moduleSettingsError) throw new Error(moduleSettingsError.message);
  const modules = {
    events: moduleSettings?.events_enabled === true,
    memberships: moduleSettings?.memberships_enabled === true,
    crm: moduleSettings?.crm_automation_enabled === true,
    line: moduleSettings?.line_channel_enabled === true,
    legacy: moduleSettings?.legacy_progress_enabled === true,
    beauty: moduleSettings?.beauty_operations_enabled === true,
  };

  return (
    <div className="admin-shell admin-shell-brand min-h-screen">
      <AdminProductTelemetry />
      <AdminNav role={member.role} isPlatformAdmin={Boolean(platformAdmin)} platformAccessType={platformAdmin?.accessType} platformPermissions={platformAdmin?.permissions} hasBrandContext modules={modules} />
      <div className="min-h-screen lg:pl-56">
        <header className="admin-topbar">
          <div className="admin-topbar-inner flex-wrap sm:flex-nowrap">
            <div className="min-w-0 flex-1 overflow-hidden"><Brand name={member.clinicName} subtitle="管理後台" /></div>
            {member.clinics.length > 1 && (
              <form action={setActiveClinicAction} className="order-3 flex w-full items-center gap-2 sm:order-none sm:w-auto">
                <label htmlFor="active-clinic" className="sr-only">切換品牌</label>
                <select id="active-clinic" name="clinic_id" defaultValue={member.clinicId} className="input h-9 min-w-0 flex-1 py-1 text-xs sm:w-auto sm:flex-none">
                  {member.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
                </select>
                <SubmitButton className="btn btn-secondary h-9 px-3 text-xs">切換</SubmitButton>
              </form>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              {hasDualAdminContext && <a href="/admin/platform" className="btn btn-secondary min-h-10 shrink-0 whitespace-nowrap px-3 py-1.5 text-xs">系統總控台</a>}
              <span className="hidden text-xs text-slate-400 sm:inline">{brandAccessLabel(member.accessType)}</span>
              <form action={signOutAction}>
                <SubmitButton className="btn btn-ghost px-3 py-1.5 text-sm">登出</SubmitButton>
              </form>
            </div>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
