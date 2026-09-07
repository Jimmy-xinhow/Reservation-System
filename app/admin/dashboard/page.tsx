import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getAssignedDoctorIds, requireMember } from "@/lib/admin";
import { taipeiDateString } from "@/lib/slots";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PermissionHelpButton } from "@/components/AdminProductTelemetry";
import { ScheduleTimeline, TrendLineChart } from "@/components/admin/OperationsCharts";
import { SubmitButton } from "@/components/SubmitButton";
import { buildThreads } from "@/lib/chatQueries";
import { recordButtonAttendanceAction } from "../handoff/attendance-actions";

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
  end_at: string;
  status: string;
  doctors: { name: string } | null;
  services: { name: string } | null;
}
interface RegistrationRow {
  created_at: string;
  status: string;
  payment_status: string;
  amount: number;
}
interface PaymentRow { status: string; amount: number; }
interface DeliveryRow { status: string; }
interface AttendanceEventRow { event_type: "clock_in" | "clock_out"; occurred_at: string; }
interface SalesOrderRow { total_amount: number; paid_amount: number; status: string; }
interface PurchaseOrderRow { status: string; purchase_order_items: Array<{ quantity: number; unit_cost: number }> | null; }
interface InventoryItemRow { stock_on_hand: number; reorder_level: number; retail_price: number; }
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

function taipeiMinute(value: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const member = await requireMember();
  const { clinicId, role } = member;
  const supabase = await createSupabaseServer();
  const { data: productSettings, error: productSettingsError } = await supabase
    .from("clinic_settings")
    .select("public_booking_enabled, public_registration_enabled, events_enabled, memberships_enabled, crm_automation_enabled, line_channel_enabled, email_enabled, deposit_enabled, brand_page_enabled")
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
    brandPageReady: productSettings.brand_page_enabled === true && Boolean(setupReads[0].data?.slug),
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
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthStartIso = new Date(`${monthStart}T00:00:00+08:00`).toISOString();
  const todayStartIso = new Date(`${today}T00:00:00+08:00`).toISOString();
  const todayEndIso = new Date(`${today}T23:59:59.999+08:00`).toISOString();

  let appointmentsQuery = supabase
    .from("appointments")
    .select("start_at, end_at, status, doctors(name), services(name)")
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

  const [attendanceSettingsResult, attendanceResult, handoffResult, salesPaymentsResult, salesOrdersResult, purchaseOrdersResult, inventoryResult, chatThreads] = await Promise.all([
    supabase.from("attendance_settings").select("click_enabled, qr_enabled").eq("clinic_id", clinicId).maybeSingle(),
    supabase.from("attendance_events").select("event_type, occurred_at").eq("clinic_id", clinicId).eq("user_id", member.user.id).gte("occurred_at", todayStartIso).lte("occurred_at", todayEndIso).order("occurred_at", { ascending: false }).limit(20),
    supabase.from("handoff_tasks").select("id, priority, status", { count: "exact" }).eq("clinic_id", clinicId).neq("status", "done").limit(50),
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("sales_payments").select("amount, received_at").eq("clinic_id", clinicId).gte("received_at", monthStartIso).lte("received_at", todayEndIso),
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("sales_orders").select("total_amount, paid_amount, status").eq("clinic_id", clinicId).neq("status", "void").gte("created_at", monthStartIso).lte("created_at", todayEndIso),
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("purchase_orders").select("status, purchase_order_items(quantity, unit_cost)").eq("clinic_id", clinicId).in("status", ["ordered", "received"]).gte("created_at", monthStartIso).lte("created_at", todayEndIso),
    role === "provider" ? Promise.resolve({ data: [], error: null }) : supabase.from("inventory_items").select("stock_on_hand, reorder_level, retail_price").eq("clinic_id", clinicId).eq("active", true),
    role === "provider" || productSettings.line_channel_enabled !== true ? Promise.resolve([]) : buildThreads(supabase, clinicId),
  ]);
  const supplementalError = [attendanceSettingsResult.error, attendanceResult.error, handoffResult.error, salesPaymentsResult.error, salesOrdersResult.error, purchaseOrdersResult.error, inventoryResult.error].find(Boolean);
  if (supplementalError && supplementalError.code !== "42P01") throw new Error(`工作台摘要載入失敗：${supplementalError.message}`);

  const attendanceEvents = (attendanceResult.data ?? []) as AttendanceEventRow[];
  const latestAttendance = attendanceEvents[0];
  const attendanceSettings = attendanceSettingsResult.data ?? { click_enabled: true, qr_enabled: false };
  const openHandoffTasks = handoffResult.data ?? [];
  const highPriorityHandoffs = openHandoffTasks.filter((task) => task.priority === "high").length;
  const monthlyRevenue = (salesPaymentsResult.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const salesOrders = (salesOrdersResult.data ?? []) as SalesOrderRow[];
  const outstandingRevenue = salesOrders.reduce((sum, row) => sum + Math.max(0, Number(row.total_amount) - Number(row.paid_amount)), 0);
  const purchaseOrders = (purchaseOrdersResult.data ?? []) as unknown as PurchaseOrderRow[];
  const monthlyPurchaseCost = purchaseOrders.reduce((sum, order) => sum + (order.purchase_order_items ?? []).reduce((lineSum, line) => lineSum + Number(line.quantity) * Number(line.unit_cost), 0), 0);
  const inventoryItems = (inventoryResult.data ?? []) as InventoryItemRow[];
  const stockRetailValue = inventoryItems.reduce((sum, item) => sum + Number(item.stock_on_hand) * Number(item.retail_price), 0);
  const lowStockCount = inventoryItems.filter((item) => Number(item.stock_on_hand) <= Number(item.reorder_level)).length;
  const unreadChatCount = chatThreads.reduce((sum, thread) => sum + thread.unread, 0);
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
  const publicBrandUrl = setupReads?.[0].data?.slug && productSettings.brand_page_enabled
    ? `/?clinic_slug=${encodeURIComponent(setupReads[0].data.slug)}`
    : null;

  const days = Array.from({ length: 14 }, (_, i) => shiftDate(winStart, i));
  const perDay = days.map((date) => ({ date, bookings: activeAppointments.filter((item) => taipeiDateString(item.start_at) === date).length, registrations: activeRegistrations.filter((item) => taipeiDateString(item.created_at) === date).length }));
  const todayTimeline = todayAppointments.map((item, index) => ({ id: `${item.start_at}-${index}`, label: item.doctors?.name ?? "未指定", service: item.services?.name ?? "未指定服務", status: item.status, startMinute: taipeiMinute(item.start_at), endMinute: taipeiMinute(item.end_at) }));
  const statusCounts = countBy(appointments, (item) => item.status);
  const providerCounts = countBy(activeAppointments, (item) => item.doctors?.name ?? "未指定");
  const maxProvider = Math.max(1, ...Object.values(providerCounts));

  return (
    <div className="admin-page">
      <AutoRefresh seconds={30} />
      <div className="admin-page-header"><div><p className="eyebrow">今日營運</p><h1 className="admin-page-title">{role === "provider" ? "我的今日工作台" : "今日工作台"}</h1><p className="admin-page-description">{role === "provider" ? "只顯示已指派給你的預約與今日工作。" : "先處理需要行動的事項，再查看營運趨勢。"}</p></div><div className="flex flex-wrap gap-2">{publicBrandUrl && <Link href={publicBrandUrl} target="_blank" className="btn btn-secondary">品牌形象頁 ↗</Link>}<Link href="/admin/calendar" className="btn btn-secondary">日曆</Link>{role !== "provider" && <Link href="/admin/reports" className="btn btn-primary">報表</Link>}</div></div>

      {params.notice === "permission" && (
        <div role="status" className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>你的員工權限未包含剛才的功能，因此已安全返回今日工作台。若工作需要使用該功能，請聯絡品牌管理者到「團隊與權限」調整授權。</span>
          <PermissionHelpButton />
        </div>
      )}

      <div className="admin-metric-strip grid-cols-2 sm:grid-cols-5"><Stat label="今日預約" value={todayAppointments.length} accent />{eventsEnabled && role !== "provider" && <Stat label="今日活動報名" value={todayRegistrations.length} />}<Stat label="待確認" value={waitingConfirmation} tone={waitingConfirmation ? "warning" : undefined} />{role !== "provider" && <Stat label="待付款" value={pendingPayments} tone={pendingPayments ? "warning" : undefined} />}<Stat label="未來 7 日預約" value={upcomingAppointments.length} /></div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <section className="admin-section"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">今日待處理</h2><p className="mt-0.5 text-xs text-slate-500">需要人工確認或補救的工作。</p></div><span className="text-xs text-slate-400">每 30 秒更新</span></div><div className="grid divide-y divide-slate-200 md:grid-cols-2 md:divide-x md:divide-y-0">{<ActionCard href="/admin" label="待確認預約" value={waitingConfirmation} description={waitingConfirmation ? "請確認或聯絡顧客" : "目前沒有待確認預約"} tone={waitingConfirmation ? "warning" : "neutral"} />}{eventsEnabled && role !== "provider" && <ActionCard href="/admin/registrations" label="待付款報名" value={pendingPayments} description={pendingPayments ? "檢查付款狀態與逾時" : "目前沒有待付款"} tone={pendingPayments ? "warning" : "neutral"} />}{role !== "provider" && <ActionCard href="/admin/reports" label="通知失敗" value={failedDeliveries} description={failedDeliveries ? "查看投遞紀錄" : "近期沒有失敗"} tone={failedDeliveries ? "danger" : "neutral"} />}{role !== "provider" && <ActionCard href="/admin/reports" label="近期未到" value={noShows} description={noShows ? "可檢查回訪與分眾" : "近期沒有未到"} tone={noShows ? "warning" : "neutral"} />}</div></section>
        <section className="admin-section p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">出勤與交班</p><h2 className="font-semibold text-slate-900">我的打卡</h2><p className="mt-1 text-xs leading-5 text-slate-500">{latestAttendance ? `最近：${latestAttendance.event_type === "clock_in" ? "上班" : "下班"} ${new Date(latestAttendance.occurred_at).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })}` : "今天尚無打卡紀錄"}</p></div><Link href="/admin/handoff" className="text-xs font-semibold text-brand-700">交班 {openHandoffTasks.length} 項 →</Link></div>
          {attendanceSettings.click_enabled && <div className="mt-4 grid grid-cols-2 gap-2"><form action={recordButtonAttendanceAction}><input type="hidden" name="event_type" value="clock_in" /><SubmitButton className="btn btn-primary w-full">上班打卡</SubmitButton></form><form action={recordButtonAttendanceAction}><input type="hidden" name="event_type" value="clock_out" /><SubmitButton className="btn btn-secondary w-full">下班打卡</SubmitButton></form></div>}
          <div className="mt-3 grid grid-cols-2 gap-2"><Link href="/admin/handoff#attendance-scanner" className="btn btn-secondary text-center">掃描 QR</Link><Link href="/admin/handoff#attendance-manager" className="btn btn-secondary text-center">顯示 QR</Link></div>
          <p className={`mt-3 text-xs ${highPriorityHandoffs ? "text-amber-700" : "text-slate-500"}`}>{highPriorityHandoffs ? `${highPriorityHandoffs} 項高優先交班尚未完成` : "目前沒有高優先交班"}</p>
        </section>
      </div>

      {role !== "provider" && <div className="grid gap-5 lg:grid-cols-2">
        <section className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">本月營運與庫存</h2><p className="mt-0.5 text-xs text-slate-500">收款、待收、採購與庫存數字使用同一品牌資料。</p></div><Link href="/admin/operations/finance" className="text-xs font-semibold text-brand-700">查看財務摘要 →</Link></div>
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0"><MoneyMetric label="本月已收" value={monthlyRevenue} /><MoneyMetric label="銷售待收" value={outstandingRevenue} /><MoneyMetric label="本月採購" value={monthlyPurchaseCost} /><MoneyMetric label="庫存售價值" value={stockRetailValue} /></div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm"><span className={lowStockCount ? "font-medium text-amber-700" : "text-slate-500"}>{lowStockCount ? `${lowStockCount} 項低於補貨提醒量` : "目前沒有低庫存品項"}</span><Link href="/admin/beauty/supply" className="btn btn-secondary px-3 py-1.5">採購與盤點</Link></div>
        </section>
        <section className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">客服對話</h2><p className="mt-0.5 text-xs text-slate-500">直接看見最近對話與未讀狀態。</p></div><Link href="/admin/chat" className="text-xs font-semibold text-brand-700">開啟客服視窗 →</Link></div>
          {chatThreads.length === 0 ? <p className="p-6 text-sm text-slate-400">目前沒有客服對話。</p> : <div className="divide-y divide-slate-200">{chatThreads.slice(0, 3).map((thread) => <Link key={thread.lineUserId} href="/admin/chat" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"><span className={`h-2 w-2 rounded-full ${thread.unread ? "bg-red-500" : "bg-slate-300"}`} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-800">{thread.name ?? "LINE 顧客"}</strong><span className="block truncate text-xs text-slate-500">{thread.lastBody}</span></span>{thread.unread > 0 && <span className="badge bg-red-50 text-red-700">{thread.unread} 未讀</span>}</Link>)}</div>}
          <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">全部未讀訊息：<strong className={unreadChatCount ? "text-red-700" : "text-slate-700"}>{unreadChatCount}</strong></div>
        </section>
      </div>}

      <section className="admin-section p-4"><div className="flex flex-wrap items-center gap-2"><span className="mr-2 text-sm font-semibold text-slate-800">常用操作</span><Link href={`/admin/calendar?modal=new&date=${today}`} className="btn btn-primary">＋ 新增預約</Link>{eventsEnabled && role !== "provider" && <Link href="/admin/events" className="btn btn-secondary">建立活動／課程</Link>}<Link href="/admin/patients" className="btn btn-secondary">顧客管理</Link>{role !== "provider" && <Link href="/admin/checkout?modal=new" className="btn btn-secondary">建立銷售單</Link>}<Link href="/admin/handoff" className="btn btn-secondary">新增交班待辦</Link></div></section>

      {setupItems.length > 0 && setupItems.some((item) => item.status !== "done") && <BrandSetupGuide items={setupItems} />}

      <div className="admin-workbench-grid"><section className="admin-section p-4"><div><h2 className="font-semibold text-slate-900">預約與報名趨勢</h2><p className="mt-1 text-xs text-slate-500">近 14 日數量曲線，可直接辨識尖峰與低谷。</p></div><TrendLineChart data={perDay} today={today} /></section><section className="admin-section p-4"><div><h2 className="font-semibold text-slate-900">今日人員排程</h2><p className="mt-1 text-xs text-slate-500">甘特式時間軸顯示服務人員佔用區間與狀態。</p></div><ScheduleTimeline items={todayTimeline} /></section></div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2"><section className="admin-section p-4"><h2 className="mb-4 font-semibold text-slate-900">預約狀態</h2><div className="space-y-2.5">{Object.keys(STATUS_LABEL).map((key) => { const count = statusCounts[key] ?? 0; const total = appointments.length || 1; return <div key={key} className="flex items-center gap-3 text-sm"><span className="w-14 shrink-0 text-slate-600">{STATUS_LABEL[key]}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${STATUS_COLOR[key]}`} style={{ width: `${count / total * 100}%` }} /></div><span className="w-8 shrink-0 text-right text-slate-500">{count}</span></div>; })}</div></section><section className="admin-section p-4"><h2 className="mb-4 font-semibold text-slate-900">服務提供者分佈</h2>{Object.keys(providerCounts).length === 0 ? <p className="text-sm text-slate-400">尚無資料</p> : <div className="space-y-2.5">{Object.entries(providerCounts).map(([name, count]) => <div key={name} className="flex items-center gap-3 text-sm"><span className="w-24 shrink-0 truncate text-slate-600">{name}</span><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-accent-500" style={{ width: `${count / maxProvider * 100}%` }} /></div><span className="w-8 shrink-0 text-right text-slate-500">{count}</span></div>)}</div>}</section></div>

      <section className="admin-section p-5"><h2 className="mb-4 font-semibold text-slate-900">資料範圍摘要</h2><div className="grid gap-x-8 text-sm sm:grid-cols-2 xl:grid-cols-4"><SummaryLine label="可管理顧客" value={role === "provider" ? "依指派範圍" : `${patientCount ?? 0} 人`} /><SummaryLine label="近期付款成功" value={`${payments.filter((item) => item.status === "paid").length} 筆`} /><SummaryLine label="通知已送達" value={`${deliveries.filter((item) => item.status === "sent").length} 筆`} /><SummaryLine label="資料時間範圍" value={`${winStart} 至 ${winEnd}`} /></div></section>
    </div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: number | string; accent?: boolean; tone?: "warning" }) { return <div className={`admin-metric ${tone === "warning" ? "bg-amber-50" : accent ? "border-t-2 border-t-brand-600" : ""}`}><div className="admin-metric-label">{label}</div><div className={`admin-metric-value ${tone === "warning" ? "text-amber-700" : ""}`}>{value}</div></div>; }
function MoneyMetric({ label, value }: { label: string; value: number }) { return <div className="min-w-0 px-4 py-4"><span className="block text-xs text-slate-500">{label}</span><strong className="mt-1 block truncate text-lg tabular-nums text-slate-900">NT${value.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}</strong></div>; }
function ActionCard({ href, label, value, description, tone }: { href: string; label: string; value: number; description: string; tone: "warning" | "danger" | "neutral" }) { return <Link href={href} className={`flex min-h-20 items-center gap-3 px-4 py-3 transition hover:bg-slate-50 ${tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-800" : "text-slate-800"}`}><span className={`h-2 w-2 shrink-0 rounded-full ${tone === "danger" ? "bg-red-500" : tone === "warning" ? "bg-amber-500" : "bg-slate-300"}`} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span><strong className="text-xl tabular-nums">{value}</strong></Link>; }
function SummaryLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-800">{value}</span></div>; }
function BrandSetupGuide({ items }: { items: SetupItem[] }) {
  const next = items.find((item) => item.status === "blocked") ?? items.find((item) => item.status === "warning");
  const completed = items.filter((item) => item.status === "done").length;
  return (
    <details className="admin-section group">
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div>
          <p className="font-semibold text-slate-900">新品牌上線準備</p>
          <p className="mt-1 text-sm text-slate-600">{next ? `下一步：${next.label}－${next.reason}` : "所有設定步驟皆已完成"}</p>
        </div>
        <span className="badge shrink-0 bg-white text-brand-700">{completed}／{items.length} 完成 · 展開</span>
      </summary>
      <div className="border-t border-brand-100 px-5 pb-5 pt-4">
        <p className="mb-4 text-sm leading-6 text-slate-600">依序處理尚未完成的項目；「需確認」代表可先使用部分功能，但正式上線前仍要測試。</p>
        <div className="admin-setup-list border-y border-slate-200">{items.map((item, index) => <Link key={item.label} href={item.href} className="admin-setup-row" data-status={item.status}><span className="admin-setup-row-number">{item.status === "done" ? "✓" : index + 1}</span><strong>{item.label.replace(/^\d+\.\s*/, "")}</strong><p>{item.reason}</p><span className="admin-setup-row-state">{item.status === "done" ? "已完成" : item.status === "warning" ? "需確認" : "尚未完成"} →</span></Link>)}</div>
      </div>
    </details>
  );
}
function buildSetupItems(state: { brandReady: boolean; brandPageReady: boolean; serviceReady: boolean; peopleOrResourcesReady: boolean; scheduleReady: boolean; publicFlowReady: boolean; lineEnabled: boolean; lineReady: boolean; richMenuReady: boolean; notificationReady: boolean; paymentRequired: boolean; paymentReady: boolean; }): SetupItem[] {
  const operationsReady = state.brandReady && state.serviceReady && state.peopleOrResourcesReady && state.scheduleReady && state.publicFlowReady;
  const lineLaunchReady = !state.lineEnabled || (state.lineReady && state.richMenuReady);
  const paymentLaunchReady = !state.paymentRequired || state.paymentReady;
  return [
    { label: "1. 品牌資料", href: "/admin/settings?section=brand", status: state.brandReady ? "done" : "blocked", reason: state.brandReady ? "品牌名稱與短網址已完成" : "缺少品牌名稱或短網址" },
    { label: "2. 品牌形象頁", href: "/admin/settings?section=page", status: state.brandPageReady ? "done" : "warning", reason: state.brandPageReady ? "公開形象頁已啟用，可從工作台直接查看" : "尚未啟用公開形象頁" },
    { label: "3. 服務／活動", href: "/admin/services", status: state.serviceReady ? "done" : "blocked", reason: state.serviceReady ? "已有可營運的服務或活動" : "至少建立一項服務；啟用活動時也可建立活動" },
    { label: "4. 人員／資源／排班", href: "/admin/schedules", status: state.peopleOrResourcesReady && state.scheduleReady ? "done" : "blocked", reason: !state.peopleOrResourcesReady ? "缺少服務提供者或資源" : state.scheduleReady ? "人員／資源與排班已建立" : "尚未建立可用排班" },
    { label: "5. 預約與報名規則", href: "/admin/settings?section=booking", status: state.publicFlowReady ? "done" : "warning", reason: state.publicFlowReady ? "至少一個公開流程已開放" : "目前沒有開放預約或報名入口" },
    { label: "6. LINE 官方帳號入口", href: "/admin/line", status: !state.lineEnabled ? "warning" : state.lineReady && state.richMenuReady ? "done" : "blocked", reason: !state.lineEnabled ? "LINE 入口未啟用，可先使用一般瀏覽器網址" : !state.lineReady ? "LINE 登入與顧客入口尚未完成驗證" : state.richMenuReady ? "LINE 連線與圖文選單已就緒" : "尚未發布 LINE 圖文選單" },
    { label: "7. 通知與付款", href: "/admin/settings?section=channels", status: state.notificationReady && paymentLaunchReady ? "done" : "warning", reason: !state.notificationReady ? "尚未啟用 LINE 或 Email 通知" : !paymentLaunchReady ? "已要求訂金，但標準金流尚未啟用" : "通知與必要付款設定已完成" },
    { label: "8. 上線前測試", href: "/admin/audit", status: operationsReady && lineLaunchReady && paymentLaunchReady ? "warning" : "blocked", reason: operationsReady && lineLaunchReady && paymentLaunchReady ? "測試環境已就緒；請完成一次真實預約、通知與付款流程" : "前面的必要設定尚未全部完成" },
  ];
}
function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> { return items.reduce<Record<string, number>>((result, item) => { const key = getKey(item); result[key] = (result[key] ?? 0) + 1; return result; }, {}); }
