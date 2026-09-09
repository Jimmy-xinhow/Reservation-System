import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { replyMessages, type LineMessage } from "@/lib/line";
import { syncLineAudienceMenu } from "@/lib/line-audience-menu";
import { buildLineExperienceCard, lineBrandTheme, type LineFlexButton } from "@/lib/line-ui-templates";

interface StaffContext {
  service: SupabaseClient;
  clinicId: string;
  clinicName: string;
  lineAccessToken: string;
  brandTemplate: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

interface AppointmentRow {
  start_at: string;
  status: string;
  patients: { name: string } | { name: string }[] | null;
  services: { name: string } | { name: string }[] | null;
  doctors: { name: string } | { name: string }[] | null;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function taipeiDayRange(): { start: string; end: string } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    start: new Date(`${date}T00:00:00+08:00`).toISOString(),
    end: new Date(`${date}T23:59:59.999+08:00`).toISOString(),
  };
}

function time(value: string): string {
  return new Date(value).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
}

function staffCard(context: StaffContext, input: {
  altText: string;
  badge: string;
  title: string;
  body: string;
  highlight: [string, string];
  details: Array<[string, string]>;
  buttons?: LineFlexButton[];
}): LineMessage {
  const theme = lineBrandTheme(context.brandTemplate, context.brandPrimaryColor, context.brandAccentColor);
  return buildLineExperienceCard({
    ...input,
    context: `${context.clinicName}｜員工作業`,
    accent: theme.primary,
    softAccent: theme.soft,
    markerColor: theme.accent,
    buttons: input.buttons ?? [],
  }) as LineMessage;
}

export async function handleLineStaffCommand(
  replyToken: string,
  lineUserId: string | undefined,
  text: string,
  context: StaffContext,
): Promise<boolean> {
  if (!lineUserId || !["今日工作", "今日行程", "待確認", "報到狀況"].includes(text)) return false;
  const { data: staff, error: staffError } = await context.service
    .from("attendance_staff")
    .select("user_id, display_name")
    .eq("clinic_id", context.clinicId)
    .eq("line_user_id", lineUserId)
    .eq("active", true)
    .maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff?.user_id) return false;

  await syncLineAudienceMenu(context.service, context.clinicId, lineUserId, "staff", context.lineAccessToken).catch(() => false);
  if (text === "待確認") {
    await replyPending(replyToken, context);
    return true;
  }
  if (text === "報到狀況") {
    await replyCheckin(replyToken, context);
    return true;
  }
  await replyToday(replyToken, String(staff.user_id), String(staff.display_name ?? "夥伴"), context);
  return true;
}

async function replyToday(replyToken: string, userId: string, displayName: string, context: StaffContext): Promise<void> {
  const range = taipeiDayRange();
  const [{ data: member }, { data: assignments }] = await Promise.all([
    context.service.from("clinic_members").select("role, access_type").eq("clinic_id", context.clinicId).eq("user_id", userId).maybeSingle(),
    context.service.from("doctor_assignments").select("doctor_id").eq("clinic_id", context.clinicId).eq("user_id", userId).eq("active", true),
  ]);
  let query = context.service
    .from("appointments")
    .select("start_at, status, patients(name), services(name), doctors(name)")
    .eq("clinic_id", context.clinicId)
    .gte("start_at", range.start)
    .lte("start_at", range.end)
    .neq("status", "cancelled")
    .order("start_at")
    .limit(20);
  const providerOnly = member?.role === "provider" && member?.access_type !== "brand_admin";
  const doctorIds = (assignments ?? []).map((row) => String(row.doctor_id));
  if (providerOnly) {
    if (!doctorIds.length) {
      await replyMessages(replyToken, [staffCard(context, {
        altText: `${displayName}今天沒有被指派的行程`,
        badge: "今日工作",
        title: "今天沒有指派行程",
        body: "目前沒有需要處理的服務行程；若排程有更新，可再次查詢。",
        highlight: ["服務人員", displayName],
        details: [["今日行程", "0 筆"], ["資料範圍", "僅顯示你被指派的工作"]],
        buttons: [{ label: "重新查詢", primary: true, action: { type: "postback", data: "action=staff_today", displayText: "今日工作" } }],
      })], context.lineAccessToken);
      return;
    }
    query = query.in("doctor_id", doctorIds);
  }
  const [{ data, error }, { data: tasks, error: taskError }] = await Promise.all([
    query,
    context.service.from("handoff_tasks").select("title, priority, due_at").eq("clinic_id", context.clinicId).neq("status", "done").or(`assigned_to.is.null,assigned_to.eq.${userId}`).order("priority", { ascending: false }).limit(5),
  ]);
  if (error || taskError) throw new Error(error?.message ?? taskError?.message ?? "今日工作讀取失敗");
  const rows = (data ?? []) as unknown as AppointmentRow[];
  const schedules = rows.length ? rows.map((row) => `${time(row.start_at)}｜${one(row.patients)?.name ?? "顧客"}｜${one(row.services)?.name ?? "服務"}｜${one(row.doctors)?.name ?? "未指派"}`).join("\n") : "今天沒有服務行程";
  const handoffs = tasks?.length ? tasks.map((task) => `${task.priority === "high" ? "重要｜" : ""}${task.title}`).join("\n") : "沒有未完成交班";
  await replyMessages(replyToken, [staffCard(context, {
    altText: `${displayName}的今日工作：${rows.length}筆行程`,
    badge: "今日工作",
    title: `${displayName}，這是今天的安排`,
    body: "行程與交班待辦集中顯示；內容會依你的品牌權限篩選。",
    highlight: ["今日行程", `${rows.length} 筆`],
    details: [["行程摘要", schedules], ["交班待辦", handoffs]],
    buttons: [
      { label: "查看待確認", primary: true, action: { type: "postback", data: "action=staff_pending", displayText: "待確認" } },
      { label: "查看報到狀況", action: { type: "postback", data: "action=staff_checkin", displayText: "報到狀況" } },
    ],
  })], context.lineAccessToken);
}

async function replyPending(replyToken: string, context: StaffContext): Promise<void> {
  const [{ count: appointmentCount, error: appointmentError }, { count: registrationCount, error: registrationError }] = await Promise.all([
    context.service.from("appointments").select("id", { count: "exact", head: true }).eq("clinic_id", context.clinicId).eq("status", "booked"),
    context.service.from("registrations").select("id", { count: "exact", head: true }).eq("clinic_id", context.clinicId).eq("status", "pending"),
  ]);
  if (appointmentError || registrationError) throw new Error(appointmentError?.message ?? registrationError?.message ?? "待確認數量讀取失敗");
  const total = (appointmentCount ?? 0) + (registrationCount ?? 0);
  await replyMessages(replyToken, [staffCard(context, {
    altText: `目前共有${total}筆待確認事項`,
    badge: "待確認",
    title: total > 0 ? "有新的項目等待處理" : "目前沒有待確認事項",
    body: "預約與活動／課程報名分開統計，方便安排處理順序。",
    highlight: ["待處理合計", `${total} 筆`],
    details: [["預約", `${appointmentCount ?? 0} 筆`], ["活動／課程報名", `${registrationCount ?? 0} 筆`]],
    buttons: [{ label: "回到今日工作", primary: true, action: { type: "postback", data: "action=staff_today", displayText: "今日工作" } }],
  })], context.lineAccessToken);
}

async function replyCheckin(replyToken: string, context: StaffContext): Promise<void> {
  const range = taipeiDayRange();
  const { data: sessions, error: sessionError } = await context.service.from("event_sessions").select("id").eq("clinic_id", context.clinicId).gte("start_at", range.start).lte("start_at", range.end).eq("active", true);
  if (sessionError) throw new Error(sessionError.message);
  const sessionIds = (sessions ?? []).map((session) => String(session.id));
  if (!sessionIds.length) {
    await replyMessages(replyToken, [staffCard(context, {
      altText: "今天沒有需要報到的活動或課程",
      badge: "報到狀況",
      title: "今天沒有報到場次",
      body: "目前沒有進行中的活動或課程場次。",
      highlight: ["今日場次", "0 場"],
      details: [["已報到", "0 人"], ["尚待報到", "0 人"]],
      buttons: [{ label: "回到今日工作", primary: true, action: { type: "postback", data: "action=staff_today", displayText: "今日工作" } }],
    })], context.lineAccessToken);
    return;
  }
  const { data, error } = await context.service.from("registrations").select("status").eq("clinic_id", context.clinicId).in("session_id", sessionIds).neq("status", "cancelled");
  if (error) throw new Error(error.message);
  const total = data?.length ?? 0;
  const attended = (data ?? []).filter((row) => row.status === "attended").length;
  const noShow = (data ?? []).filter((row) => row.status === "no_show").length;
  const waiting = Math.max(0, total - attended - noShow);
  await replyMessages(replyToken, [staffCard(context, {
    altText: `今日報到${attended}/${total}，尚待${waiting}人`,
    badge: "報到狀況",
    title: waiting > 0 ? "報到正在進行中" : "今日報到已確認",
    body: "即時整理已報到、未到與尚待報到人數。",
    highlight: ["已報到", `${attended}／${total} 人`],
    details: [["尚待報到", `${waiting} 人`], ["未到", `${noShow} 人`]],
    buttons: [
      { label: "重新整理", primary: true, action: { type: "postback", data: "action=staff_checkin", displayText: "報到狀況" } },
      { label: "回到今日工作", action: { type: "postback", data: "action=staff_today", displayText: "今日工作" } },
    ],
  })], context.lineAccessToken);
}
