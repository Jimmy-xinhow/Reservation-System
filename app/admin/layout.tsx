import { getOptionalMember } from "@/lib/admin";
import { getOptionalPlatformAdmin } from "@/lib/platform";
import { signOutAction, setActiveClinicAction } from "./actions";
import { Brand } from "@/components/Brand";
import { AdminNav } from "@/components/AdminNav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [member, platformAdmin] = await Promise.all([getOptionalMember(), getOptionalPlatformAdmin()]);
  if (!member && !platformAdmin) return <>{children}</>;

  if (!member && platformAdmin) {
    return (
      <div className="min-h-screen bg-[#f5f8fb]">
        <AdminNav role="owner" isPlatformAdmin />
        <div className="min-h-screen lg:pl-72">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center gap-3 px-4 pl-16 sm:px-6 sm:pl-16 lg:px-8 lg:pl-8">
              <Brand name="XINHOW SaaS" subtitle="總管理後台" />
              <div className="ml-auto flex items-center gap-2"><span className="hidden text-xs text-slate-400 sm:inline">{platformAdmin.role}</span><form action={signOutAction}><SubmitButton className="btn btn-ghost px-3 py-1.5 text-sm">登出</SubmitButton></form></div>
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
      <AdminNav role={member.role} isPlatformAdmin={Boolean(platformAdmin)} />
      <div className="min-h-screen lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center gap-3 px-4 pl-16 sm:px-6 sm:pl-16 lg:px-8 lg:pl-8">
            <Brand name={member.clinicName} subtitle="工程後台" />
            {member.clinics.length > 1 && (
              <form action={setActiveClinicAction} className="hidden items-center gap-2 md:flex">
                <label htmlFor="active-clinic" className="sr-only">切換品牌</label>
                <select id="active-clinic" name="clinic_id" defaultValue={member.clinicId} className="input h-9 w-auto py-1 text-xs">
                  {member.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
                </select>
                <SubmitButton className="btn btn-secondary h-9 px-3 text-xs">切換</SubmitButton>
              </form>
            )}
            <div className="ml-auto flex items-center gap-2">
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
