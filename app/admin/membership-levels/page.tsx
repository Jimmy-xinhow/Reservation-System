import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { assignPatientMembershipLevelAction, createMembershipLevelAction, saveMembershipPlanLevelPriceAction, toggleMembershipLevelAction } from "../memberships/actions";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";

export const dynamic = "force-dynamic";

interface Level { id: string; code: string; name: string; sort_order: number; discount_percent: number; active: boolean; }
interface Plan { id: string; name: string; price: number; }
interface Patient { id: string; name: string; phone: string; membership_level_id: string | null; }
interface PriceRule { id: string; plan_id: string; level_id: string; price: number; }

export default async function MembershipLevelsPage() {
  const { clinicId, supabase } = await requireAdmin();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "memberships"))) return <ModuleDisabled title="會員與套票" />;
  const service = createServiceClient();
  const [{ data: levels }, { data: plans }, { data: prices }, { data: patients }] = await Promise.all([
    service.from("membership_levels").select("id, code, name, sort_order, discount_percent, active").eq("clinic_id", clinicId).order("sort_order").order("name"),
    service.from("membership_plans").select("id, name, price").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("membership_plan_level_prices").select("id, plan_id, level_id, price").eq("clinic_id", clinicId),
    service.from("patients").select("id, name, phone, membership_level_id").eq("clinic_id", clinicId).eq("active", true).order("name").limit(500),
  ]);
  const levelRows = (levels ?? []) as Level[];
  const planRows = (plans ?? []) as Plan[];
  const priceRows = (prices ?? []) as PriceRule[];
  const patientRows = (patients ?? []) as Patient[];
  const levelName = new Map(levelRows.map((level) => [level.id, level.name]));
  const planName = new Map(planRows.map((plan) => [plan.id, plan.name]));

  return <div className="space-y-6">
    <div><p className="eyebrow">Membership pricing</p><h1 className="text-xl font-bold text-slate-900">會員等級與專屬價格</h1><p className="mt-1 text-sm text-slate-500">設定品牌自己的會員層級、等級折扣與方案價格；沒有設定的顧客會使用方案原價。</p></div>
    <section className="card p-5"><h2 className="font-semibold text-slate-900">建立會員等級</h2><form action={createMembershipLevelAction} className="mt-4 grid gap-3 sm:grid-cols-4"><input className="input" name="code" placeholder="例如：gold" required /><input className="input" name="name" placeholder="例如：金卡" required /><input className="input" name="sort_order" type="number" min="0" defaultValue="0" placeholder="排序" /><input className="input" name="discount_percent" type="number" min="0" max="100" defaultValue="0" placeholder="等級折扣 %" /><SubmitButton className="btn btn-primary sm:col-span-4">建立等級</SubmitButton></form></section>
    <section className="card p-5"><h2 className="font-semibold text-slate-900">方案專屬價格</h2><form action={saveMembershipPlanLevelPriceAction} className="mt-4 grid gap-3 sm:grid-cols-4"><select className="input" name="plan_id" required defaultValue=""><option value="" disabled>選擇會員方案</option>{planRows.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}（原價 NT${plan.price.toLocaleString("zh-TW")}）</option>)}</select><select className="input" name="level_id" required defaultValue=""><option value="" disabled>選擇等級</option>{levelRows.filter((level) => level.active).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select><input className="input" name="price" type="number" min="0" required placeholder="專屬價格" /><SubmitButton className="btn btn-primary">儲存價格</SubmitButton></form><div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">{priceRows.length === 0 ? <p className="py-4 text-sm text-slate-400">尚未設定等級專屬價格。</p> : priceRows.map((rule) => <div key={rule.id} className="flex justify-between py-3 text-sm"><span>{planName.get(rule.plan_id) ?? "未知方案"} × {levelName.get(rule.level_id) ?? "未知等級"}</span><span className="font-medium">NT${rule.price.toLocaleString("zh-TW")}</span></div>)}</div></section>
    <section className="card p-5"><h2 className="font-semibold text-slate-900">顧客等級指派</h2><div className="mt-4 divide-y divide-slate-100">{patientRows.length === 0 ? <p className="py-4 text-sm text-slate-400">尚無顧客資料。</p> : patientRows.map((patient) => <form key={patient.id} action={assignPatientMembershipLevelAction} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-48 flex-1"><p className="text-sm font-medium text-slate-800">{patient.name}</p><p className="text-xs text-slate-500">{patient.phone}</p></div><input type="hidden" name="patient_id" value={patient.id} /><select className="input max-w-52" name="level_id" defaultValue={patient.membership_level_id ?? ""}><option value="">一般顧客</option>{levelRows.filter((level) => level.active).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select><SubmitButton className="btn btn-secondary text-xs">更新</SubmitButton></form>)}</div></section>
    <section className="card p-5"><h2 className="font-semibold text-slate-900">目前等級</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{levelRows.map((level) => <div key={level.id} className="rounded-xl border border-slate-100 p-4"><div className="flex items-center justify-between gap-2"><p className="font-medium text-slate-800">{level.name}</p><form action={toggleMembershipLevelAction}><input type="hidden" name="id" value={level.id} /><input type="hidden" name="active" value={String(level.active)} /><SubmitButton className="text-xs text-slate-500">{level.active ? "停用" : "啟用"}</SubmitButton></form></div><p className="mt-1 text-xs text-slate-500">{level.code} · 等級折扣 {level.discount_percent}%</p></div>)}</div></section>
  </div>;
}
