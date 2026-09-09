import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { replyMessages } from "@/lib/line";
import { syncLineAudienceMenu } from "@/lib/line-audience-menu";

interface StaffContext {
  service: SupabaseClient;
  clinicId: string;
  lineAccessToken: string;
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
      await replyMessages(replyToken, [{ type: "text", text: `${displayName}，你今天沒有被指派的服務行程。` }], context.lineAccessToken);
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
  await replyMessages(replyToken, [{ type: "text", text: `${displayName}的今日工作\n\n行程\n${schedules}\n\n交班待辦\n${handoffs}` }], context.lineAccessToken);
}

async function replyPending(replyToken: string, context: StaffContext): Promise<void> {
  const [{ count: appointmentCount, error: appointmentError }, { count: registrationCount, error: registrationError }] = await Promise.all([
    context.service.from("appointments").select("id", { count: "exact", head: true }).eq("clinic_id", context.clinicId).eq("status", "booked"),
    context.service.from("registrations").select("id", { count: "exact", head: true }).eq("clinic_id", context.clinicId).eq("status", "pending"),
  ]);
  if (appointmentError || registrationError) throw new Error(appointmentError?.message ?? registrationError?.message ?? "待確認數量讀取失敗");
  await replyMessages(replyToken, [{ type: "text", text: `目前待確認\n預約 ${appointmentCount ?? 0} 筆\n活動／課程報名 ${registrationCount ?? 0} 筆` }], context.lineAccessToken);
}

async function replyCheckin(replyToken: string, context: StaffContext): Promise<void> {
  const range = taipeiDayRange();
  const { data: sessions, error: sessionError } = await context.service.from("event_sessions").select("id").eq("clinic_id", context.clinicId).gte("start_at", range.start).lte("start_at", range.end).eq("active", true);
  if (sessionError) throw new Error(sessionError.message);
  const sessionIds = (sessions ?? []).map((session) => String(session.id));
  if (!sessionIds.length) {
    await replyMessages(replyToken, [{ type: "text", text: "今天沒有需要報到的活動或課程。" }], context.lineAccessToken);
    return;
  }
  const { data, error } = await context.service.from("registrations").select("status").eq("clinic_id", context.clinicId).in("session_id", sessionIds).neq("status", "cancelled");
  if (error) throw new Error(error.message);
  const total = data?.length ?? 0;
  const attended = (data ?? []).filter((row) => row.status === "attended").length;
  const noShow = (data ?? []).filter((row) => row.status === "no_show").length;
  await replyMessages(replyToken, [{ type: "text", text: `今日報到狀況\n已報到 ${attended}／${total}\n未到 ${noShow}\n尚待報到 ${Math.max(0, total - attended - noShow)}` }], context.lineAccessToken);
}
