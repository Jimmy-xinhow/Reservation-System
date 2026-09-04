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
      <div className="admin-shell min-h-screen bg-[#f1f4ff]">
        <AdminNav role="owner" isPlatformAdmin platformAccessType={platformAdmin.accessType} platformPermissions={platformAdmin.permissions} hasBrandContext={Boolean(member)} />
        <div className="min-h-screen lg:pl-64">
          <header className="sticky top-0 z-20 border-b border-indigo-100 bg-white/95 backdrop-blur">
            <div className="mx-auto flex min-h-14 max-w-[1480px] flex-wrap items-center gap-2 px-4 py-2 pl-16 sm:flex-nowrap sm:gap-3 sm:px-6 sm:pl-16 lg:px-6 lg:pl-6">
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#18245b] text-sm font-bold tracking-wide text-white shadow-sm sm:h-10 sm:w-10">XP</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold tracking-tight text-slate-950 sm:text-base">XINHOW PLATFORM</div>
                  <div className="hidden truncate text-xs text-indigo-700 md:block">系統管理控制台 · 跨品牌管理</div>
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                <span className="badge hidden bg-indigo-50 text-indigo-700 md:inline-flex">{platformAccessLabel(platformAdmin.accessType)}</span>
                {hasDualAdminContext && (
                  <a href="/admin/dashboard" className="btn btn-secondary min-h-10 shrink-0 whitespace-nowrap px-3 py-1.5 text-xs">
                    <span className="sm:hidden">品牌後台</span><span className="hidden sm:inline">返回品牌後台</span>
                  </a>
                )}
                <form action={signOutAction}><SubmitButton className="btn btn-ghost min-h-10 shrink-0 px-2.5 py-1.5 text-sm sm:px-3">登出</SubmitButton></form>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1480px] p-4 sm:p-5 lg:p-6">{children}</main>
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
    <div className="admin-shell min-h-screen bg-[#f5f8fb]">
      <AdminProductTelemetry />
      <AdminNav role={member.role} isPlatformAdmin={Boolean(platformAdmin)} platformAccessType={platformAdmin?.accessType} platformPermissions={platformAdmin?.permissions} hasBrandContext modules={modules} />
      <div className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex min-h-14 max-w-[1480px] flex-wrap items-center gap-2 px-4 py-2 pl-16 sm:gap-3 sm:px-6 sm:pl-16 lg:flex-nowrap lg:px-6 lg:pl-6">
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
        <main className="mx-auto w-full max-w-[1480px] p-4 sm:p-5 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
