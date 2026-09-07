import { SubmitButton } from "@/components/SubmitButton";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { saveCommissionRuleAction } from "../../beauty/actions";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
interface DoctorRow { id: string; name: string; }
interface ServiceRow { id: string; name: string; price: number; }
interface RuleRow { id: string; doctor_id: string; service_id: string | null; amount_per_service: number; calculation_type: "fixed" | "percent"; rate_percent: number; doctors: Relation<{ name: string }>; services: Relation<{ name: string; price: number }>; }
const twd = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });

export default async function CommissionOperationsPage() {
  const { clinicId } = await requireOperator();
  const service = createServiceClient();
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
  const [doctorsResult, servicesResult, rulesResult, completedResult] = await Promise.all([
    service.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("services").select("id, name, price").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("beauty_commission_rules").select("id, doctor_id, service_id, amount_per_service, calculation_type, rate_percent, doctors(name), services(name, price)").eq("clinic_id", clinicId).eq("active", true),
    service.from("appointments").select("id, doctor_id, service_id").eq("clinic_id", clinicId).eq("status", "done").gte("start_at", startOfMonth.toISOString()),
  ]);
  const firstError = [doctorsResult, servicesResult, rulesResult, completedResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  const doctors = (doctorsResult.data ?? []) as DoctorRow[];
  const services = (servicesResult.data ?? []) as ServiceRow[];
  const rules = (rulesResult.data ?? []) as unknown as RuleRow[];
  const completed = (completedResult.data ?? []) as Array<{ id: string; doctor_id: string | null; service_id: string | null }>;
  const rows = doctors.map((doctor) => {
    const done = completed.filter((appointment) => appointment.doctor_id === doctor.id);
    const amount = done.reduce((sum, appointment) => {
      const rule = rules.find((item) => item.doctor_id === doctor.id && item.service_id === appointment.service_id) ?? rules.find((item) => item.doctor_id === doctor.id && item.service_id === null);
      if (!rule) return sum;
      const price = Number(one(rule.services)?.price ?? services.find((item) => item.id === appointment.service_id)?.price ?? 0);
      return sum + (rule.calculation_type === "percent" ? Math.round(price * Number(rule.rate_percent) / 100) : Number(rule.amount_per_service));
    }, 0);
    return { doctor, count: done.length, amount };
  });

  return <div className="admin-page">
    <header className="admin-page-header"><div><p className="eyebrow">營運中心</p><h1 className="admin-page-title">服務獎金試算</h1><p className="admin-page-description">依本月已完成服務與設定規則試算人員獎金；數字供內部營運參考，不取代薪資與會計結算。</p></div></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.65fr)]">
      <section className="grid gap-3 sm:grid-cols-2">{rows.length === 0 ? <div className="admin-section p-8 text-sm text-slate-500 sm:col-span-2">尚未建立服務人員。</div> : rows.map(({ doctor, count, amount }) => <article key={doctor.id} className="admin-section p-5"><p className="text-sm text-slate-500">{doctor.name}</p><p className="mt-2 text-2xl font-bold text-slate-900">{twd.format(amount)}</p><p className="mt-1 text-sm text-slate-500">本月完成 {count} 次服務</p></article>)}</section>
      <form action={saveCommissionRuleAction} className="admin-section h-fit space-y-4 p-5"><div><h2 className="font-semibold text-slate-900">設定獎金規則</h2><p className="mt-1 text-xs text-slate-500">可針對單一服務或全部服務設定。</p></div><label><span className="label">服務人員</span><select name="doctor_id" className="input" required defaultValue=""><option value="" disabled>請選擇</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label><label><span className="label">指定服務（留空代表通用）</span><select name="service_id" className="input" defaultValue=""><option value="">所有服務</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name} · {twd.format(item.price)}</option>)}</select></label><label><span className="label">計算方式</span><select name="calculation_type" className="input" defaultValue="fixed"><option value="fixed">固定金額</option><option value="percent">服務售價百分比</option></select></label><div className="grid grid-cols-2 gap-3"><label><span className="label">固定金額（元）</span><input type="number" min="0" name="amount_per_service" defaultValue="0" className="input" /></label><label><span className="label">百分比（%）</span><input type="number" min="0" max="100" step="0.01" name="rate_percent" defaultValue="0" className="input" /></label></div><p className="text-xs leading-5 text-slate-500">系統只採用選定的計算方式，另一欄可維持 0。</p><SubmitButton className="btn btn-primary w-full">儲存試算規則</SubmitButton>{rules.length > 0 && <div className="space-y-2 border-t border-slate-200 pt-4 text-sm">{rules.map((rule) => <p key={rule.id} className="flex justify-between gap-3"><span>{one(rule.doctors)?.name} · {one(rule.services)?.name ?? "所有服務"}</span><strong>{rule.calculation_type === "percent" ? `${Number(rule.rate_percent).toLocaleString("zh-TW")}%` : twd.format(rule.amount_per_service)}</strong></p>)}</div>}</form>
    </div>
  </div>;
}
