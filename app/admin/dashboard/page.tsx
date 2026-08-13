import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getAssignedDoctorIds, requireMember } from "@/lib/admin";
import { taipeiDateString } from "@/lib/slots";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PermissionHelpButton } from "@/components/AdminProductTelemetry";

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
type SetupStatus = "done" | "warning" | "blocked";
interface SetupItem { label: string; href: string; status: SetupStatus; reason: string; }

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const member = await requireMember();
  const { clinicId, role } = member;
  const supabase = await createSupabaseServer();
  const { data: productSettings, error: productSettingsError } = await supabase
    .from("clinic_settings")
    .select("public_booking_enabled, public_registration_enabled, events_enabled, memberships_enabled, crm_automation_enabled, line_channel_enabled, email_enabled, deposit_enabled")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (productSettingsError || !productSettings) throw new Error(productSettingsError?.message ?? "品牌設定載入失敗");
  const setupReads = role === "owner" || role === "admin"
    ? await Promise.all([
        supabase.from("clinics").select("name, slug").eq("id", clinicId).maybeSingle(),
        supabase.from("services").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
        supabase.from("events").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId),
        supabase.from("doctors").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
        supabase.from("service_resources").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
        supabase.from("schedule_templates").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
        supabase.from("clinic_line_channels").select("verification_status, liff_id").eq("clinic_id", clinicId).maybeSingle(),
        supabase.from("line_richmenu").select("published_version_id, published_id").eq("clinic_id", clinicId).maybeSingle(),
        supabase.from("clinic_payment_settings").select("active").eq("clinic_id", clinicId).maybeSingle(),
      ])
    : null;
  if (setupReads?.some((result) => result.error)) throw new Error(setupReads.find((result) => result.error)?.error?.message ?? "品牌開通資料載入失敗");
  const setupItems = setupReads ? buildSetupItems({
    brandReady: Boolean(setupReads[0].data?.name && setupReads[0].data?.slug),
    serviceReady: (setupReads[1].count ?? 0) > 0 || (productSettings.events_enabled && (setupReads[2].count ?? 0) > 0),
    peopleOrResourcesReady: (setupReads[3].count ?? 0) > 0 || (setupReads[4].count ?? 0) > 0,
    scheduleReady: (setupReads[5].count ?? 0) > 0,
    publicFlowReady: productSettings.public_booking_enabled || (productSettings.events_enabled && productSettings.public_registration_enabled),
    lineEnabled: productSettings.line_channel_enabled,
    lineReady: setupReads[6].data?.verification_status === "ready" && Boolean(setupReads[6].data?.liff_id),
    richMenuReady: Boolean(setupReads[7].data?.published_version_id || setupReads[7].data?.published_id),
    notificationReady: productSettings.email_enabled || productSettings.line_channel_enabled,
    paymentRequired: productSettings.deposit_enabled,
    paymentReady: setupReads[8].data?.active === true,
  }) : [];
  const assignedDoctorIds = await getAssignedDoctorIds(member);
  const eventsEnabled = productSettings.events_enabled === true;
  const crmEnabled = productSettings.crm_automation_enabled === true;
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
    role === "provider" || !eventsEnabled ? Promise.resolve({ data: [], error: null }) : supabase.from("registrations").select("created_at, status, payment_status, amount").eq("clinic_id", clinicId).gte("created_at", winStartIso).lte("created_at", winEndIso),
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("payment_orders").select("status, amount").eq("clinic_id", clinicId).gte("created_at", winStartIso).lte("created_at", winEndIso),
    role === "provider" || !crmEnabled ? Promise.resolve({ data: [], error: null }) : supabase.from("crm_delivery_logs").select("status").eq("clinic_id", clinicId).gte("created_at", winStartIso).lte("created_at", winEndIso),
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Today</p><h1 className="text-2xl font-bold text-slate-900">{role === "provider" ? "我的今日工作台" : "今日工作台"}</h1><p className="mt-1 text-sm text-slate-500">{role === "provider" ? "只顯示已指派給你的預約與今日工作。" : "先處理今天需要行動的事項，再查看營運趨勢。"}</p></div><div className="flex gap-2"><Link href="/admin/calendar" className="btn btn-secondary">查看日曆</Link>{role !== "provider" && <Link href="/admin/reports" className="btn btn-primary">查看報表</Link>}</div></div>

      {params.notice === "permission" && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>你的員工權限未包含剛才的功能，因此已安全返回今日工作台。若工作需要使用該功能，請聯絡品牌管理者到「團隊與權限」調整授權。</span>
          <PermissionHelpButton />
        </div>
      )}

      {setupItems.length > 0 && setupItems.some((item) => item.status !== "done") && <BrandSetupGuide items={setupItems} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Stat label="今日預約" value={todayAppointments.length} accent />{eventsEnabled && role !== "provider" && <Stat label="今日活動報名" value={todayRegistrations.length} />}<Stat label="待確認" value={waitingConfirmation} tone={waitingConfirmation ? "warning" : undefined} />{role !== "provider" && <Stat label="待付款" value={pendingPayments} tone={pendingPayments ? "warning" : undefined} />}<Stat label="未來 7 日預約" value={upcomingAppointments.length} /></div>

      <section className="card space-y-4 p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">今日待處理</h2><p className="mt-1 text-sm text-slate-500">把需要人工確認或補救的工作集中在這裡。</p></div><span className="text-xs text-slate-400">每 30 秒更新</span></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><ActionCard href="/admin" label="待確認預約" value={waitingConfirmation} description={waitingConfirmation ? "請確認或聯絡顧客" : "目前沒有待確認預約"} tone={waitingConfirmation ? "warning" : "neutral"} />{eventsEnabled && role !== "provider" && <ActionCard href="/admin/registrations" label="待付款報名" value={pendingPayments} description={pendingPayments ? "檢查付款狀態與逾時" : "目前沒有待付款"} tone={pendingPayments ? "warning" : "neutral"} />}{role !== "provider" && <ActionCard href="/admin/reports" label="通知失敗" value={failedDeliveries} description={failedDeliveries ? "查看投遞紀錄" : "近期沒有失敗"} tone={failedDeliveries ? "danger" : "neutral"} />}{role !== "provider" && <ActionCard href="/admin/reports" label="近期未到" value={noShows} description={noShows ? "可檢查回訪與分眾" : "近期沒有未到"} tone={noShows ? "warning" : "neutral"} />}</div></section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><section className="card p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">預約與報名趨勢</h2><p className="mt-1 text-xs text-slate-500">近 14 日建立／安排數量；深色為今天。</p></div><div className="flex gap-3 text-xs text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-600" />預約</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-accent-500" />報名</span></div></div><div className="mt-5 flex h-40 items-end gap-1.5">{perDay.map((item) => <div key={item.date} className="flex h-full flex-1 flex-col items-center gap-1"><span className="text-[10px] text-slate-500">{item.bookings + item.registrations || ""}</span><div className="flex w-full flex-1 items-end gap-0.5"><div className={`w-1/2 rounded-t ${item.date === today ? "bg-brand-600" : "bg-brand-200"}`} style={{ height: item.bookings ? `${Math.max(5, item.bookings / maxDay * 100)}%` : "2px" }} /><div className={`w-1/2 rounded-t ${item.date === today ? "bg-accent-500" : "bg-accent-200"}`} style={{ height: item.registrations ? `${Math.max(5, item.registrations / maxDay * 100)}%` : "2px" }} /></div><span className={`text-[10px] ${item.date === today ? "font-bold text-brand-700" : "text-slate-400"}`}>{item.date.slice(5)}</span></div>)}</div></section><section className="card p-5"><h2 className="mb-4 font-semibold text-slate-900">預約狀態</h2><div className="space-y-2.5">{Object.keys(STATUS_LABEL).map((key) => { const count = statusCounts[key] ?? 0; const total = appointments.length || 1; return <div key={key} className="flex items-center gap-3 text-sm"><span className="w-14 shrink-0 text-slate-600">{STATUS_LABEL[key]}</span><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${STATUS_COLOR[key]}`} style={{ width: `${count / total * 100}%` }} /></div><span className="w-8 shrink-0 text-right text-slate-500">{count}</span></div>; })}</div></section></div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><section className="card p-5"><h2 className="mb-4 font-semibold text-slate-900">服務提供者分佈</h2>{Object.keys(providerCounts).length === 0 ? <p className="text-sm text-slate-400">尚無資料</p> : <div className="space-y-2.5">{Object.entries(providerCounts).map(([name, count]) => <div key={name} className="flex items-center gap-3 text-sm"><span className="w-24 shrink-0 truncate text-slate-600">{name}</span><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-accent-500" style={{ width: `${count / maxProvider * 100}%` }} /></div><span className="w-8 shrink-0 text-right text-slate-500">{count}</span></div>)}</div>}</section><section className="card p-5"><h2 className="mb-4 font-semibold text-slate-900">資料範圍摘要</h2><div className="space-y-2 text-sm"><SummaryLine label="可管理顧客" value={role === "provider" ? "依指派範圍" : `${patientCount ?? 0} 人`} /><SummaryLine label="近期付款成功" value={`${payments.filter((item) => item.status === "paid").length} 筆`} /><SummaryLine label="通知已送達" value={`${deliveries.filter((item) => item.status === "sent").length} 筆`} /><SummaryLine label="資料時間範圍" value={`${winStart} 至 ${winEnd}`} /></div></section></div>
    </div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: number | string; accent?: boolean; tone?: "warning" }) { return <div className={`card p-4 ${accent ? "bg-gradient-to-br from-brand-500 to-accent-600 text-white" : tone === "warning" ? "border-amber-200 bg-amber-50" : ""}`}><div className={`text-xs ${accent ? "text-white/80" : "text-slate-500"}`}>{label}</div><div className={`mt-1 text-2xl font-bold ${accent ? "text-white" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</div></div>; }
function ActionCard({ href, label, value, description, tone }: { href: string; label: string; value: number; description: string; tone: "warning" | "danger" | "neutral" }) { return <Link href={href} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 ${tone === "danger" ? "border-red-200 bg-red-50" : tone === "warning" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-700">{label}</span><span className={`text-2xl font-bold ${tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{description}</p></Link>; }
function SummaryLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-800">{value}</span></div>; }
function BrandSetupGuide({ items }: { items: SetupItem[] }) {
  const next = items.find((item) => item.status === "blocked") ?? items.find((item) => item.status === "warning");
  const completed = items.filter((item) => item.status === "done").length;
  return <section className="card space-y-4 border-brand-100 bg-brand-50/40 p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="eyebrow">新品牌啟用中心</p><h2 className="mt-1 font-semibold text-slate-900">七步判斷是否可正式上線</h2><p className="mt-1 text-sm leading-6 text-slate-500">依序處理阻擋項；警告代表可先使用部分功能，但尚未具備完整渠道條件。</p></div><span className="badge bg-white text-brand-700">{completed}／{items.length} 完成</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{items.map((item, index) => <Link key={item.label} href={item.href} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 ${item.status === "done" ? "border-emerald-200 bg-emerald-50" : item.status === "warning" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}><div className="flex items-center justify-between gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${item.status === "done" ? "bg-emerald-600" : item.status === "warning" ? "bg-amber-500" : "bg-red-600"}`}>{item.status === "done" ? "✓" : index + 1}</span><span className={`text-xs font-medium ${item.status === "done" ? "text-emerald-700" : item.status === "warning" ? "text-amber-700" : "text-red-700"}`}>{item.status === "done" ? "已完成" : item.status === "warning" ? "需確認" : "阻擋"}</span></div><p className="mt-3 text-sm font-medium text-slate-800">{item.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.reason}</p></Link>)}</div>{next && <p className="text-xs font-medium text-brand-800">下一步：{next.label}－{next.reason}</p>}</section>;
}
function buildSetupItems(state: { brandReady: boolean; serviceReady: boolean; peopleOrResourcesReady: boolean; scheduleReady: boolean; publicFlowReady: boolean; lineEnabled: boolean; lineReady: boolean; richMenuReady: boolean; notificationReady: boolean; paymentRequired: boolean; paymentReady: boolean; }): SetupItem[] {
  const operationsReady = state.brandReady && state.serviceReady && state.peopleOrResourcesReady && state.scheduleReady && state.publicFlowReady;
  const lineLaunchReady = !state.lineEnabled || (state.lineReady && state.richMenuReady);
  const paymentLaunchReady = !state.paymentRequired || state.paymentReady;
  return [
    { label: "1. 品牌資料", href: "/admin/settings?section=brand", status: state.brandReady ? "done" : "blocked", reason: state.brandReady ? "品牌名稱與短網址已完成" : "缺少品牌名稱或短網址" },
    { label: "2. 服務／活動", href: "/admin/services", status: state.serviceReady ? "done" : "blocked", reason: state.serviceReady ? "已有可營運的服務或活動" : "至少建立一項服務；啟用活動時也可建立活動" },
    { label: "3. 人員／資源／排班", href: "/admin/schedules", status: state.peopleOrResourcesReady && state.scheduleReady ? "done" : "blocked", reason: !state.peopleOrResourcesReady ? "缺少服務提供者或資源" : state.scheduleReady ? "人員／資源與排班已建立" : "尚未建立可用排班" },
    { label: "4. 預約與報名規則", href: "/admin/settings?section=booking", status: state.publicFlowReady ? "done" : "warning", reason: state.publicFlowReady ? "至少一個公開流程已開放" : "目前沒有開放預約或報名入口" },
    { label: "5. LINE／LIFF／Rich Menu", href: "/admin/line", status: !state.lineEnabled ? "warning" : state.lineReady && state.richMenuReady ? "done" : "blocked", reason: !state.lineEnabled ? "LINE 渠道未啟用，可先使用瀏覽器備援" : !state.lineReady ? "LINE／LIFF 尚未完成正式驗證" : state.richMenuReady ? "渠道與 Rich Menu 已就緒" : "尚未發布 Rich Menu" },
    { label: "6. 通知與付款", href: "/admin/settings?section=channels", status: state.notificationReady && paymentLaunchReady ? "done" : "warning", reason: !state.notificationReady ? "尚未啟用 LINE 或 Email 通知" : !paymentLaunchReady ? "已要求訂金，但標準金流尚未啟用" : "通知與必要付款設定已完成" },
    { label: "7. 正式上線測試", href: "/admin/audit", status: operationsReady && lineLaunchReady && paymentLaunchReady ? "warning" : "blocked", reason: operationsReady && lineLaunchReady && paymentLaunchReady ? "測試環境已就緒；完成正式渠道 smoke test 後才可上線" : "前置阻擋尚未全部排除" },
  ];
}
function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> { return items.reduce<Record<string, number>>((result, item) => { const key = getKey(item); result[key] = (result[key] ?? 0) + 1; return result; }, {}); }
