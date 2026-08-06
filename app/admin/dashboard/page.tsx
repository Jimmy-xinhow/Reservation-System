import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getAssignedDoctorIds, requireMember } from "@/lib/admin";
import { taipeiDateString } from "@/lib/slots";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  booked: "待確認",
  confirmed: "已確認",
  done: "已完成",
  no_show: "未到",
  cancelled: "已取消",
};
const STATUS_COLOR: Record<string, string> = {
  booked: "bg-brand-500",
  confirmed: "bg-accent-500",
  done: "bg-slate-400",
  no_show: "bg-amber-500",
  cancelled: "bg-red-400",
};

interface AppointmentRow {
  start_at: string;
  status: string;
  doctors: { name: string } | null;
}
interface RegistrationRow {
  created_at: string;
  status: string;
  payment_status: string;
  amount: number;
}
interface PaymentRow { status: string; amount: number; }
interface DeliveryRow { status: string; }

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await searchParams;
  const member = await requireMember();
  const { clinicId, role } = member;
  const supabase = await createSupabaseServer();
  const setupReads = role === "owner" || role === "admin"
    ? await Promise.all([
        supabase.from("clinics").select("name, slug").eq("id", clinicId).maybeSingle(),
        supabase.from("clinic_settings").select("public_booking_enabled, public_registration_enabled").eq("clinic_id", clinicId).maybeSingle(),
        supabase.from("services").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
        supabase.from("schedule_templates").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
      ])
    : null;
  if (setupReads?.some((result) => result.error)) throw new Error(setupReads.find((result) => result.error)?.error?.message ?? "品牌開通資料載入失敗");
  const setupItems = setupReads ? [
    { label: "完成品牌基本資料與公開入口", href: "/admin/settings", done: Boolean(setupReads[0].data?.name && setupReads[0].data?.slug && (setupReads[1].data?.public_booking_enabled || setupReads[1].data?.public_registration_enabled)) },
    { label: "建立至少一項服務", href: "/admin/services", done: (setupReads[2].count ?? 0) > 0 },
    { label: "建立至少一段服務排程", href: "/admin/schedules", done: (setupReads[3].count ?? 0) > 0 },
  ] : [];
  const assignedDoctorIds = await getAssignedDoctorIds(member);
  const today = taipeiToday();
  const winStart = shiftDate(today, -6);
  const winEnd = shiftDate(today, 7);
  const winStartIso = new Date(`${winStart}T00:00:00+08:00`).toISOString();
  const winEndIso = new Date(`${winEnd}T23:59:59.999+08:00`).toISOString();

  let appointmentsQuery = supabase
    .from("appointments")
    .select("start_at, status, doctors(name)")
    .eq("clinic_id", clinicId)
    .gte("start_at", winStartIso)
    .lte("start_at", winEndIso);
  if (role === "provider") {
    appointmentsQuery = appointmentsQuery.in("doctor_id", assignedDoctorIds.length > 0 ? assignedDoctorIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const [{ data: appointmentData, error: appointmentError }, { data: registrationData, error: registrationError }, { data: paymentData, error: paymentError }, { data: deliveryData, error: deliveryError }, { count: patientCount }] = await Promise.all([
    appointmentsQuery,
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("registrations").select("created_at, status, payment_status, amount").eq("clinic_id", clinicId).gte("created_at", winStartIso).lte("created_at", winEndIso),
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("payment_orders").select("status, amount").eq("clinic_id", clinicId).gte("created_at", winStartIso).lte("created_at", winEndIso),
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("crm_delivery_logs").select("status").eq("clinic_id", clinicId).gte("created_at", winStartIso).lte("created_at", winEndIso),
    role === "provider" ? Promise.resolve({ count: null as number | null }) : supabase.from("patients").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
  ]);

  if (appointmentError || registrationError || paymentError || deliveryError) {
    throw new Error(appointmentError?.message ?? registrationError?.message ?? paymentError?.message ?? deliveryError?.message ?? "營運資料載入失敗");
  }

  const appointments = (appointmentData ?? []) as unknown as AppointmentRow[];
  const registrations = (registrationData ?? []) as unknown as RegistrationRow[];
  const payments = (paymentData ?? []) as unknown as PaymentRow[];
  const deliveries = (deliveryData ?? []) as unknown as DeliveryRow[];
  const activeAppointments = appointments.filter((item) => item.status !== "cancelled");
  const activeRegistrations = registrations.filter((item) => item.status !== "cancelled");
  const todayAppointments = activeAppointments.filter((item) => taipeiDateString(item.start_at) === today);
  const todayRegistrations = activeRegistrations.filter((item) => taipeiDateString(item.created_at) === today);
  const upcomingAppointments = activeAppointments.filter((item) => {
    const date = taipeiDateString(item.start_at);
    return date >= today && date <= shiftDate(today, 6);
  });
  const waitingConfirmation = todayAppointments.filter((item) => item.status === "booked").length;
  const pendingPayments = activeRegistrations.filter((item) => item.payment_status === "pending").length + payments.filter((item) => item.status === "pending").length;
  const failedDeliveries = deliveries.filter((item) => item.status === "failed").length;
  const noShows = activeAppointments.filter((item) => item.status === "no_show").length + activeRegistrations.filter((item) => item.status === "no_show").length;

  const days = Array.from({ length: 14 }, (_, i) => shiftDate(winStart, i));
  const perDay = days.map((date) => ({ date, bookings: activeAppointments.filter((item) => taipeiDateString(item.start_at) === date).length, registrations: activeRegistrations.filter((item) => taipeiDateString(item.created_at) === date).length }));
  const maxDay = Math.max(1, ...perDay.map((item) => item.bookings + item.registrations));
  const statusCounts = countBy(appointments, (item) => item.status);
  const providerCounts = countBy(activeAppointments, (item) => item.doctors?.name ?? "未指定");
  const maxProvider = Math.max(1, ...Object.values(providerCounts));

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Operations</p><h1 className="text-2xl font-bold text-slate-900">營運總覽</h1><p className="mt-1 text-sm text-slate-500">先處理今天需要行動的事項，再查看預約、報名與通知趨勢。</p></div><div className="flex gap-2"><Link href="/admin/calendar" className="btn btn-secondary">查看日曆</Link><Link href="/admin/reports" className="btn btn-primary">查看報表</Link></div></div>

      {setupItems.length > 0 && setupItems.some((item) => !item.done) && <BrandSetupGuide items={setupItems} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Stat label="今日預約" value={todayAppointments.length} accent /><Stat label="今日活動報名" value={todayRegistrations.length} /><Stat label="待確認" value={waitingConfirmation} tone={waitingConfirmation ? "warning" : undefined} /><Stat label="待付款" value={pendingPayments} tone={pendingPayments ? "warning" : undefined} /><Stat label="未來 7 日預約" value={upcomingAppointments.length} /></div>

      <section className="card space-y-4 p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">今日待處理</h2><p className="mt-1 text-sm text-slate-500">把需要人工確認或補救的工作集中在這裡。</p></div><span className="text-xs text-slate-400">每 30 秒更新</span></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><ActionCard href="/admin" label="待確認預約" value={waitingConfirmation} description={waitingConfirmation ? "請確認或聯絡顧客" : "目前沒有待確認預約"} tone={waitingConfirmation ? "warning" : "neutral"} /><ActionCard href="/admin/registrations" label="待付款報名" value={pendingPayments} description={pendingPayments ? "檢查付款狀態與逾時" : "目前沒有待付款"} tone={pendingPayments ? "warning" : "neutral"} /><ActionCard href="/admin/reports" label="通知失敗" value={failedDeliveries} description={failedDeliveries ? "查看投遞紀錄" : "近期沒有失敗"} tone={failedDeliveries ? "danger" : "neutral"} /><ActionCard href="/admin/reports" label="近期未到" value={noShows} description={noShows ? "可檢查回訪與分眾" : "近期沒有未到"} tone={noShows ? "warning" : "neutral"} /></div></section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><section className="card p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">預約與報名趨勢</h2><p className="mt-1 text-xs text-slate-500">近 14 日建立／安排數量；深色為今天。</p></div><div className="flex gap-3 text-xs text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-600" />預約</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-accent-500" />報名</span></div></div><div className="mt-5 flex h-40 items-end gap-1.5">{perDay.map((item) => <div key={item.date} className="flex h-full flex-1 flex-col items-center gap-1"><span className="text-[10px] text-slate-500">{item.bookings + item.registrations || ""}</span><div className="flex w-full flex-1 items-end gap-0.5"><div className={`w-1/2 rounded-t ${item.date === today ? "bg-brand-600" : "bg-brand-200"}`} style={{ height: item.bookings ? `${Math.max(5, item.bookings / maxDay * 100)}%` : "2px" }} /><div className={`w-1/2 rounded-t ${item.date === today ? "bg-accent-500" : "bg-accent-200"}`} style={{ height: item.registrations ? `${Math.max(5, item.registrations / maxDay * 100)}%` : "2px" }} /></div><span className={`text-[10px] ${item.date === today ? "font-bold text-brand-700" : "text-slate-400"}`}>{item.date.slice(5)}</span></div>)}</div></section><section className="card p-5"><h2 className="mb-4 font-semibold text-slate-900">預約狀態</h2><div className="space-y-2.5">{Object.keys(STATUS_LABEL).map((key) => { const count = statusCounts[key] ?? 0; const total = appointments.length || 1; return <div key={key} className="flex items-center gap-3 text-sm"><span className="w-14 shrink-0 text-slate-600">{STATUS_LABEL[key]}</span><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${STATUS_COLOR[key]}`} style={{ width: `${count / total * 100}%` }} /></div><span className="w-8 shrink-0 text-right text-slate-500">{count}</span></div>; })}</div></section></div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><section className="card p-5"><h2 className="mb-4 font-semibold text-slate-900">服務提供者分佈</h2>{Object.keys(providerCounts).length === 0 ? <p className="text-sm text-slate-400">尚無資料</p> : <div className="space-y-2.5">{Object.entries(providerCounts).map(([name, count]) => <div key={name} className="flex items-center gap-3 text-sm"><span className="w-24 shrink-0 truncate text-slate-600">{name}</span><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-accent-500" style={{ width: `${count / maxProvider * 100}%` }} /></div><span className="w-8 shrink-0 text-right text-slate-500">{count}</span></div>)}</div>}</section><section className="card p-5"><h2 className="mb-4 font-semibold text-slate-900">資料範圍摘要</h2><div className="space-y-2 text-sm"><SummaryLine label="可管理顧客" value={role === "provider" ? "依指派範圍" : `${patientCount ?? 0} 人`} /><SummaryLine label="近期付款成功" value={`${payments.filter((item) => item.status === "paid").length} 筆`} /><SummaryLine label="通知已送達" value={`${deliveries.filter((item) => item.status === "sent").length} 筆`} /><SummaryLine label="資料時間範圍" value={`${winStart} 至 ${winEnd}`} /></div></section></div>
    </div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: number | string; accent?: boolean; tone?: "warning" }) { return <div className={`card p-4 ${accent ? "bg-gradient-to-br from-brand-500 to-accent-600 text-white" : tone === "warning" ? "border-amber-200 bg-amber-50" : ""}`}><div className={`text-xs ${accent ? "text-white/80" : "text-slate-500"}`}>{label}</div><div className={`mt-1 text-2xl font-bold ${accent ? "text-white" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</div></div>; }
function ActionCard({ href, label, value, description, tone }: { href: string; label: string; value: number; description: string; tone: "warning" | "danger" | "neutral" }) { return <Link href={href} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 ${tone === "danger" ? "border-red-200 bg-red-50" : tone === "warning" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-700">{label}</span><span className={`text-2xl font-bold ${tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{description}</p></Link>; }
function SummaryLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-800">{value}</span></div>; }
function BrandSetupGuide({ items }: { items: Array<{ label: string; href: string; done: boolean }> }) { const next = items.find((item) => !item.done); return <section className="card space-y-4 border-brand-100 bg-brand-50/40 p-5"><div><p className="eyebrow">品牌首次開通</p><h2 className="mt-1 font-semibold text-slate-900">完成這 3 步，品牌就能開始接單</h2><p className="mt-1 text-sm leading-6 text-slate-500">這是目前品牌自己的後台。依序完成品牌資料、服務與排程；平台管理員只負責建立品牌與寄送邀請。</p></div><div className="grid gap-3 md:grid-cols-3">{items.map((item, index) => <Link key={item.label} href={item.href} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 ${item.done ? "border-emerald-200 bg-emerald-50" : "border-brand-200 bg-white"}`}><div className="flex items-center justify-between gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{item.done ? "✓" : index + 1}</span><span className="text-xs font-medium text-brand-700">{item.done ? "已完成" : "前往設定 →"}</span></div><p className="mt-3 text-sm font-medium text-slate-800">{item.label}</p></Link>)}</div>{next && <p className="text-xs text-brand-800">建議先處理：{next.label}</p>}</section>; }
function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> { return items.reduce<Record<string, number>>((result, item) => { const key = getKey(item); result[key] = (result[key] ?? 0) + 1; return result; }, {}); }
