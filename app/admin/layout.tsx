import { getOptionalMember } from "@/lib/admin";
import { signOutAction, setActiveClinicAction } from "./actions";
import { Brand } from "@/components/Brand";
import { AdminNav } from "@/components/AdminNav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 未登入(例如登入頁)不顯示導覽列
  const member = await getOptionalMember();
  if (!member) return <>{children}</>;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex items-center gap-4 py-3">
            <Brand name={member.clinicName} subtitle="後台" />
            {member.clinics.length > 1 && (
              <form action={setActiveClinicAction} className="hidden items-center gap-2 sm:flex">
                <label htmlFor="active-clinic" className="sr-only">切換品牌</label>
                <select id="active-clinic" name="clinic_id" defaultValue={member.clinicId} className="input h-9 w-auto py-1 text-xs">
                  {member.clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                  ))}
                </select>
                <SubmitButton className="btn btn-secondary h-9 px-3 text-xs">切換</SubmitButton>
              </form>
            )}
            <form action={signOutAction} className="ml-auto">
              <SubmitButton className="btn btn-ghost px-3 py-1.5 text-sm">登出</SubmitButton>
            </form>
          </div>
          <div className="pb-2">
            <AdminNav role={member.role} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
