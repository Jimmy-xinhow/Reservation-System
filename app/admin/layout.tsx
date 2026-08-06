import { getOptionalMember } from "@/lib/admin";
import { getOptionalPlatformAdmin } from "@/lib/platform";
import { headers } from "next/headers";
import Link from "next/link";
import { signOutAction, setActiveClinicAction } from "./actions";
import { Brand } from "@/components/Brand";
import { AdminNav } from "@/components/AdminNav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [member, platformAdmin] = await Promise.all([getOptionalMember(), getOptionalPlatformAdmin()]);
  const currentPath = (await headers()).get("x-admin-path") ?? "";
  const isPlatformShell = Boolean(platformAdmin && currentPath.startsWith("/admin/platform"));
  if (!member && !platformAdmin) return <>{children}</>;

  if (platformAdmin && (isPlatformShell || !member)) {
    return (
      <div className="min-h-screen bg-[#f1f4ff]">
        <AdminNav role="owner" isPlatformAdmin hasBrandContext={false} />
        <div className="min-h-screen lg:pl-72">
          <header className="sticky top-0 z-20 border-b border-indigo-100 bg-white/95 backdrop-blur">
            <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center gap-3 px-4 pl-16 sm:px-6 sm:pl-16 lg:px-8 lg:pl-8">
              <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#18245b] text-sm font-bold tracking-wide text-white shadow-sm">XP</div><div><div className="font-bold tracking-tight text-slate-950">XINHOW PLATFORM</div><div className="text-xs text-indigo-700">系統擁有者控制台 · 跨品牌租戶管理</div></div></div>
              <div className="ml-auto flex items-center gap-2"><span className="badge hidden bg-indigo-50 text-indigo-700 sm:inline">平台 {platformAdmin.role}</span>{member && <Link href="/admin" className="btn btn-secondary hidden px-3 py-1.5 text-xs sm:inline">返回品牌後台</Link>}<form action={signOutAction}><SubmitButton className="btn btn-ghost px-3 py-1.5 text-sm">登出</SubmitButton></form></div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    );
  }
  if (!member) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#f5f8fb]">
      <AdminNav role={member.role} isPlatformAdmin={Boolean(platformAdmin)} hasBrandContext />
      <div className="min-h-screen lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center gap-3 px-4 pl-16 sm:px-6 sm:pl-16 lg:px-8 lg:pl-8">
            <Brand name={member.clinicName} subtitle="管理後台" />
            {member.clinics.length > 1 && (
              <form action={setActiveClinicAction} className="order-3 flex w-full items-center gap-2 sm:order-none sm:w-auto">
                <label htmlFor="active-clinic" className="sr-only">切換品牌</label>
                <select id="active-clinic" name="clinic_id" defaultValue={member.clinicId} className="input h-9 min-w-0 flex-1 py-1 text-xs sm:w-auto sm:flex-none">
                  {member.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
                </select>
                <SubmitButton className="btn btn-secondary h-9 px-3 text-xs">切換</SubmitButton>
              </form>
            )}
            <div className="ml-auto flex items-center gap-2">
              {platformAdmin && <Link href="/admin/platform" className="hidden text-xs text-brand-700 hover:underline sm:inline">平台總控台</Link>}
              <span className="hidden text-xs text-slate-400 sm:inline">{member.role}</span>
              <form action={signOutAction}>
                <SubmitButton className="btn btn-ghost px-3 py-1.5 text-sm">登出</SubmitButton>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
