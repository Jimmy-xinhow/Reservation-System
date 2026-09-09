import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { customerEntryUrl } from "@/lib/customer-entry";
import { issueLineAccountLinkToken, replyMessages, type LineMessage } from "@/lib/line";
import { clearLineCustomerSession, getLineCustomerSession, saveLineCustomerSession } from "@/lib/line-session";
import { isClinicOpenNow } from "@/lib/queue";
import { recordCrmInteraction } from "@/lib/crm-interactions";

export interface LineCustomerJourneyContext {
  service: SupabaseClient;
  clinicId: string;
  clinicSlug: string | null;
  clinicName: string;
  liffId: string | null;
  baseUrl: string;
  lineAccessToken: string;
}

interface ClinicInfoRow {
  name: string;
  phone: string | null;
  address: string | null;
  intro: string | null;
}

interface EventRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  registration_open_at: string | null;
  registration_close_at: string | null;
}

interface RegistrationRow {
  id: string;
  registration_no: string;
  status: string;
  payment_status: string;
  amount: number;
  events: { title: string } | { title: string }[] | null;
  event_sessions: { name: string; start_at: string; venue: string | null } | { name: string; start_at: string; venue: string | null }[] | null;
}

interface MembershipRow {
  membership_code: string;
  status: string;
  credits_total: number;
  credits_remaining: number;
  expires_at: string | null;
  membership_plans: { name: string } | { name: string }[] | null;
}

const TAIPEI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function short(value: string, max = 20): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function postback(label: string, action: string): Record<string, unknown> {
  return { type: "postback", label: short(label), data: action, displayText: short(label) };
}

function serviceUrl(context: LineCustomerJourneyContext, key: "booking" | "events" | "tickets" | "membership", extraParams?: Record<string, string>): string {
  return customerEntryUrl(key, {
    baseUrl: context.baseUrl,
    clinicSlug: context.clinicSlug,
    liffId: context.liffId,
    extraParams,
  });
}

function quickReplyText(text: string, actions: Record<string, unknown>[]): LineMessage {
  return {
    type: "text",
    text,
    quickReply: { items: actions.map((action) => ({ type: "action", action })) },
  };
}

export function lineHomeMessage(context: Pick<LineCustomerJourneyContext, "clinicName">): LineMessage {
  return quickReplyText(`${context.clinicName}\n請直接選擇要辦理的事項：`, [
    postback("立即預約", "action=booking"),
    postback("我的預約", "action=my"),
    postback("活動／課程", "action=events"),
    postback("我的票券", "action=tickets"),
    postback("會員／套票", "action=membership"),
    postback("LINE 客服", "action=support"),
    postback("品牌資訊", "action=brand"),
  ]);
}

export async function replyLineHome(replyToken: string, context: LineCustomerJourneyContext): Promise<void> {
  await replyMessages(replyToken, [lineHomeMessage(context)], context.lineAccessToken);
}

export async function replyBookingServices(replyToken: string, lineUserId: string | undefined, context: LineCustomerJourneyContext): Promise<void> {
  const { data, error } = await context.service
    .from("services")
    .select("id, name, description")
    .eq("clinic_id", context.clinicId)
    .eq("active", true)
    .order("created_at")
    .limit(12);
  if (error) throw new Error(error.message);
  if (!data?.length) {
    await replyMessages(replyToken, [{ type: "text", text: "目前沒有開放中的服務，請直接聯絡客服。" }], context.lineAccessToken);
    return;
  }
  if (lineUserId) {
    await saveLineCustomerSession(context.service, context.clinicId, lineUserId, { intent: "booking", step: "choose_service", context: {} });
  }
  const actions = data.slice(0, 11).map((service) => postback(String(service.name), `action=booking_service&service_id=${encodeURIComponent(String(service.id))}`));
  if (data.length > 11) {
    actions.push({ type: "uri", label: "查看全部服務", uri: serviceUrl(context, "booking", { task: "1" }) });
  }
  await replyMessages(replyToken, [quickReplyText("先選擇要預約的服務：", actions)], context.lineAccessToken);
}

export async function replyBookingDatePrompt(
  replyToken: string,
  lineUserId: string | undefined,
  serviceId: string | null,
  context: LineCustomerJourneyContext,
): Promise<void> {
  if (!serviceId) throw new Error("缺少服務");
  const [{ data: service, error: serviceError }, { data: settings, error: settingsError }] = await Promise.all([
    context.service.from("services").select("id, name").eq("clinic_id", context.clinicId).eq("id", serviceId).eq("active", true).maybeSingle(),
    context.service.from("clinic_settings").select("max_advance_days").eq("clinic_id", context.clinicId).maybeSingle(),
  ]);
  if (serviceError || settingsError) throw new Error(serviceError?.message ?? settingsError?.message ?? "服務讀取失敗");
  if (!service) {
    await replyMessages(replyToken, [{ type: "text", text: "這項服務目前未開放，請重新選擇。" }], context.lineAccessToken);
    return;
  }
  if (lineUserId) {
    await saveLineCustomerSession(context.service, context.clinicId, lineUserId, {
      intent: "booking",
      step: "choose_date",
      context: { service_id: String(service.id) },
    });
  }
  const today = TAIPEI_DATE.format(new Date());
  const maxDate = TAIPEI_DATE.format(new Date(Date.now() + Math.max(1, Number(settings?.max_advance_days ?? 30)) * 86_400_000));
  await replyMessages(replyToken, [{
    type: "template",
    altText: `選擇${service.name}的預約日期`,
    template: {
      type: "buttons",
      title: short(String(service.name), 40),
      text: "請選擇希望預約的日期，下一步只會開啟該服務的可約時段。",
      actions: [{
        type: "datetimepicker",
        label: "選擇日期",
        data: `action=booking_date&service_id=${encodeURIComponent(String(service.id))}`,
        mode: "date",
        initial: today,
        min: today,
        max: maxDate,
      }],
    },
  }], context.lineAccessToken);
}

export async function replyBookingContinue(
  replyToken: string,
  lineUserId: string | undefined,
  serviceId: string | null,
  selectedDate: string | undefined,
  context: LineCustomerJourneyContext,
): Promise<void> {
  if (!serviceId || !selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) throw new Error("預約日期不正確");
  const { data: service, error } = await context.service
    .from("services")
    .select("id, name")
    .eq("clinic_id", context.clinicId)
    .eq("id", serviceId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!service) throw new Error("服務已停用");
  if (lineUserId) {
    await saveLineCustomerSession(context.service, context.clinicId, lineUserId, {
      intent: "booking",
      step: "open_slots",
      context: { service_id: String(service.id), date: selectedDate },
    });
  }
  const uri = serviceUrl(context, "booking", { service_id: String(service.id), date: selectedDate, task: "1" });
  await replyMessages(replyToken, [{
    type: "template",
    altText: "繼續選擇預約時段",
    template: {
      type: "buttons",
      title: short(String(service.name), 40),
      text: `${selectedDate}｜選擇可約時段並填寫必要資料`,
      actions: [{ type: "uri", label: "查看可約時段", uri }],
    },
  }], context.lineAccessToken);
}

export async function replyEvents(replyToken: string, context: LineCustomerJourneyContext): Promise<void> {
  const { data, error } = await context.service
    .from("events")
    .select("id, slug, title, description, cover_url, registration_open_at, registration_close_at")
    .eq("clinic_id", context.clinicId)
    .eq("status", "published")
    .eq("access_mode", "public")
    .order("registration_open_at", { ascending: true, nullsFirst: false })
    .limit(10);
  if (error) throw new Error(error.message);
  const now = Date.now();
  const rows = ((data ?? []) as EventRow[]).filter((event) =>
    (!event.registration_open_at || new Date(event.registration_open_at).getTime() <= now)
    && (!event.registration_close_at || new Date(event.registration_close_at).getTime() > now));
  if (!rows.length) {
    await replyMessages(replyToken, [{ type: "text", text: "目前沒有開放報名的活動或課程。" }], context.lineAccessToken);
    return;
  }
  const bubbles = rows.map((event) => ({
    type: "bubble",
    size: "kilo",
    hero: event.cover_url ? { type: "image", url: event.cover_url, size: "full", aspectRatio: "20:13", aspectMode: "cover" } : undefined,
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      { type: "text", text: event.title, weight: "bold", size: "lg", wrap: true },
      { type: "text", text: event.description?.trim() || "查看場次、票種與剩餘名額", size: "sm", color: "#64748b", wrap: true, maxLines: 3 },
    ] },
    footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "primary", color: "#126248", action: { type: "uri", label: "查看場次並報名", uri: serviceUrl(context, "events", { event: event.id, task: "1" }) } }] },
  }));
  await replyMessages(replyToken, [{ type: "flex", altText: "目前開放報名的活動與課程", contents: { type: "carousel", contents: bubbles } }], context.lineAccessToken);
}

function accountLinkUrl(context: LineCustomerJourneyContext, linkToken: string): string {
  const url = new URL("/line/account-link", context.baseUrl);
  if (context.clinicSlug) url.searchParams.set("clinic_slug", context.clinicSlug);
  url.searchParams.set("linkToken", linkToken);
  return url.toString();
}

async function replyAccountLinkPrompt(replyToken: string, lineUserId: string, context: LineCustomerJourneyContext): Promise<void> {
  const linkToken = await issueLineAccountLinkToken(lineUserId, context.lineAccessToken);
  await replyMessages(replyToken, [{
    type: "template",
    altText: "綁定 LINE 會員資料",
    template: {
      type: "buttons",
      title: "綁定會員資料",
      text: "完成一次安全驗證後，即可直接在 LINE 查詢預約、票券與會員權益。",
      actions: [{ type: "uri", label: "開始安全綁定", uri: accountLinkUrl(context, linkToken) }],
    },
  }], context.lineAccessToken);
}

export async function replyTickets(replyToken: string, lineUserId: string | undefined, context: LineCustomerJourneyContext): Promise<void> {
  if (!lineUserId) throw new Error("無法取得 LINE 身分");
  const { data, error } = await context.service
    .from("registrations")
    .select("id, registration_no, status, payment_status, amount, events(title), event_sessions(name, start_at, venue)")
    .eq("clinic_id", context.clinicId)
    .eq("line_user_id", lineUserId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RegistrationRow[];
  if (!rows.length) {
    const { count } = await context.service.from("patients").select("id", { count: "exact", head: true }).eq("clinic_id", context.clinicId).eq("line_user_id", lineUserId).eq("active", true);
    if (!count) return replyAccountLinkPrompt(replyToken, lineUserId, context);
    await replyMessages(replyToken, [quickReplyText("目前沒有可使用的活動票券。", [postback("查看開放活動", "action=events")])], context.lineAccessToken);
    return;
  }
  const bubbles = rows.map((row) => {
    const event = one(row.events);
    const session = one(row.event_sessions);
    const date = session?.start_at ? new Date(session.start_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "待確認";
    return {
      type: "bubble",
      size: "kilo",
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: event?.title ?? "活動票券", weight: "bold", size: "lg", wrap: true },
        { type: "text", text: `${session?.name ?? "場次待確認"}\n${date}`, size: "sm", color: "#475569", wrap: true },
        { type: "separator" },
        { type: "text", text: `編號 ${row.registration_no}\n報名 ${registrationStatus(row.status)}｜付款 ${paymentStatus(row.payment_status)}`, size: "xs", color: "#64748b", wrap: true },
      ] },
      footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "primary", color: "#126248", action: { type: "uri", label: "查看票券與報到碼", uri: serviceUrl(context, "tickets", { task: "1" }) } }] },
    };
  });
  await replyMessages(replyToken, [{ type: "flex", altText: "我的票券", contents: { type: "carousel", contents: bubbles } }], context.lineAccessToken);
}

export async function replyMemberships(replyToken: string, lineUserId: string | undefined, context: LineCustomerJourneyContext): Promise<void> {
  if (!lineUserId) throw new Error("無法取得 LINE 身分");
  const { data: patients, error: patientError } = await context.service
    .from("patients")
    .select("id")
    .eq("clinic_id", context.clinicId)
    .eq("line_user_id", lineUserId)
    .eq("active", true);
  if (patientError) throw new Error(patientError.message);
  const patientIds = (patients ?? []).map((patient) => String(patient.id));
  if (!patientIds.length) return replyAccountLinkPrompt(replyToken, lineUserId, context);
  const { data, error } = await context.service
    .from("patient_memberships")
    .select("membership_code, status, credits_total, credits_remaining, expires_at, membership_plans(name)")
    .eq("clinic_id", context.clinicId)
    .in("patient_id", patientIds)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as MembershipRow[];
  if (!rows.length) {
    await replyMessages(replyToken, [{ type: "template", altText: "會員與套票", template: { type: "buttons", title: "會員與套票", text: "目前沒有使用中的套票，可查看品牌提供的方案。", actions: [{ type: "uri", label: "查看可購買方案", uri: serviceUrl(context, "membership", { task: "1" }) }] } }], context.lineAccessToken);
    return;
  }
  const contents = rows.map((row) => ({
    type: "bubble",
    size: "kilo",
    body: { type: "box", layout: "vertical", spacing: "md", contents: [
      { type: "text", text: one(row.membership_plans)?.name ?? "會員套票", weight: "bold", size: "lg", wrap: true },
      { type: "text", text: `${row.credits_remaining} / ${row.credits_total}`, weight: "bold", size: "3xl", color: "#126248" },
      { type: "text", text: `剩餘堂數｜${membershipStatus(row.status)}${row.expires_at ? `\n有效至 ${new Date(row.expires_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}` : "｜不限期"}`, size: "sm", color: "#64748b", wrap: true },
    ] },
    footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
      { type: "button", style: "primary", color: "#126248", action: { type: "uri", label: "查看完整權益", uri: serviceUrl(context, "membership", { task: "1" }) } },
      { type: "button", style: "secondary", action: postback("解除會員綁定", "action=unlink_account") },
    ] },
  }));
  await replyMessages(replyToken, [{ type: "flex", altText: "會員與套票", contents: { type: "carousel", contents } }], context.lineAccessToken);
}

export async function replyBrandInfo(replyToken: string, context: LineCustomerJourneyContext): Promise<void> {
  const { data, error } = await context.service
    .from("clinics")
    .select("name, phone, address, intro")
    .eq("id", context.clinicId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const clinic = data as ClinicInfoRow | null;
  const details = [clinic?.intro, clinic?.phone ? `電話｜${clinic.phone}` : null, clinic?.address ? `地址｜${clinic.address}` : null].filter(Boolean).join("\n");
  const actions: Record<string, unknown>[] = [];
  if (clinic?.phone) actions.push({ type: "uri", label: "撥打電話", uri: `tel:${clinic.phone.replace(/[^+\d]/g, "")}` });
  actions.push({ type: "uri", label: "瀏覽品牌網站", uri: customerEntryUrl("home", { baseUrl: context.baseUrl, clinicSlug: context.clinicSlug, liffId: null, preferLiff: false }) });
  await replyMessages(replyToken, [{ type: "template", altText: `${clinic?.name ?? context.clinicName}品牌資訊`, template: { type: "buttons", title: short(clinic?.name ?? context.clinicName, 40), text: short(details || "查看品牌服務、聯絡方式與最新資訊。", 160), actions: actions.slice(0, 4) } }], context.lineAccessToken);
}

export async function startLineSupport(replyToken: string, lineUserId: string | undefined, context: LineCustomerJourneyContext): Promise<void> {
  if (!lineUserId) throw new Error("無法取得 LINE 身分");
  await saveLineCustomerSession(context.service, context.clinicId, lineUserId, { intent: "support", step: "waiting_message", context: {} }, 30);
  await replyMessages(replyToken, [quickReplyText("已進入客服對話。請直接輸入問題，品牌人員會在後台收到；完成後可點「結束客服」。", [postback("結束客服", "action=support_end")])], context.lineAccessToken);
}

export async function endLineSupport(replyToken: string, lineUserId: string | undefined, context: LineCustomerJourneyContext): Promise<void> {
  if (lineUserId) await clearLineCustomerSession(context.service, context.clinicId, lineUserId);
  await replyMessages(replyToken, [quickReplyText("客服對話已結束。需要其他服務時可直接選擇：", [postback("回到服務選單", "action=home")])], context.lineAccessToken);
}

export async function handleLineSupportText(replyToken: string, lineUserId: string | undefined, body: string, context: LineCustomerJourneyContext): Promise<boolean> {
  if (!lineUserId) return false;
  const session = await getLineCustomerSession(context.service, context.clinicId, lineUserId);
  if (session?.intent !== "support") return false;
  const { data: blocked } = await context.service.from("chat_blocks").select("line_user_id").eq("clinic_id", context.clinicId).eq("line_user_id", lineUserId).maybeSingle();
  if (!blocked) {
    const { error } = await context.service.from("chat_messages").insert({ clinic_id: context.clinicId, line_user_id: lineUserId, sender: "patient", body });
    if (error) throw new Error(error.message);
    const { data: patient } = await context.service.from("patients").select("id").eq("clinic_id", context.clinicId).eq("line_user_id", lineUserId).eq("active", true).order("created_at").limit(1).maybeSingle();
    if (patient?.id) {
      await recordCrmInteraction(context.service, { clinicId: context.clinicId, patientId: String(patient.id), kind: "message", channel: "line", title: "顧客客服訊息", body }).catch(() => undefined);
    }
  }
  await saveLineCustomerSession(context.service, context.clinicId, lineUserId, session, 30);
  const open = await isClinicOpenNow(context.service, context.clinicId);
  const message = open ? "訊息已送達客服，品牌人員將直接在 LINE 回覆。" : "訊息已送達。目前非服務時間，品牌人員會在服務時間回覆。";
  await replyMessages(replyToken, [quickReplyText(message, [postback("結束客服", "action=support_end")])], context.lineAccessToken);
  return true;
}

export function lineAccountLinkConfirmation(): LineMessage {
  return {
    type: "template",
    altText: "解除 LINE 會員綁定確認",
    template: { type: "confirm", text: "解除後將無法在 LINE 直接查詢預約、票券與會員權益。確定解除？", actions: [
      postback("確定解除", "action=unlink_confirm"),
      postback("保留綁定", "action=home"),
    ] },
  };
}

function registrationStatus(value: string): string {
  return ({ pending: "待確認", confirmed: "已確認", waitlisted: "候補中", attended: "已報到", no_show: "未到" } as Record<string, string>)[value] ?? value;
}

function paymentStatus(value: string): string {
  return ({ not_required: "免付款", pending: "待付款", paid: "已付款", failed: "失敗", expired: "逾時", refunded: "已退款" } as Record<string, string>)[value] ?? value;
}

function membershipStatus(value: string): string {
  return ({ active: "使用中", exhausted: "已用完", expired: "已到期", cancelled: "已取消" } as Record<string, string>)[value] ?? value;
}
