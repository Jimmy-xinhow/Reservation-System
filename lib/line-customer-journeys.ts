import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { customerEntryUrl } from "@/lib/customer-entry";
import { issueLineAccountLinkToken, replyMessages, type LineMessage } from "@/lib/line";
import { clearLineCustomerSession, getLineCustomerSession, saveLineCustomerSession } from "@/lib/line-session";
import { isClinicOpenNow } from "@/lib/queue";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { buildLineExperienceCard, lineBrandTheme, type LineBrandTheme, type LineFlexButton } from "@/lib/line-ui-templates";

export interface LineCustomerJourneyContext {
  service: SupabaseClient;
  clinicId: string;
  clinicSlug: string | null;
  clinicName: string;
  liffId: string | null;
  baseUrl: string;
  lineAccessToken: string;
  brandTemplate: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
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

type LineBranding = Pick<LineCustomerJourneyContext, "clinicName" | "brandTemplate" | "brandPrimaryColor" | "brandAccentColor">;

function themeFor(context: LineBranding): LineBrandTheme {
  return lineBrandTheme(context.brandTemplate, context.brandPrimaryColor, context.brandAccentColor);
}

function brandedCard(context: LineBranding, input: {
  altText: string;
  badge: string;
  title: string;
  body: string;
  highlight: [string, string];
  details: Array<[string, string]>;
  buttons?: LineFlexButton[];
}): LineMessage {
  const theme = themeFor(context);
  return buildLineExperienceCard({
    ...input,
    context: context.clinicName,
    accent: theme.primary,
    softAccent: theme.soft,
    markerColor: theme.accent,
    buttons: input.buttons ?? [],
  });
}

function withQuickReplies(message: LineMessage, actions: Record<string, unknown>[]): LineMessage {
  return {
    ...message,
    quickReply: { items: actions.map((action) => ({ type: "action", action })) },
  };
}

function cardContents(message: LineMessage): Record<string, unknown> {
  const contents = message.contents;
  return contents && typeof contents === "object" && !Array.isArray(contents)
    ? contents as Record<string, unknown>
    : { type: "bubble" };
}

function isHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}

function serviceUrl(context: LineCustomerJourneyContext, key: "booking" | "events" | "tickets" | "membership", extraParams?: Record<string, string>): string {
  return customerEntryUrl(key, {
    baseUrl: context.baseUrl,
    clinicSlug: context.clinicSlug,
    liffId: context.liffId,
    extraParams,
  });
}

export function lineHomeMessage(context: LineBranding): LineMessage {
  const actions = [
    postback("立即預約", "action=booking"),
    postback("我的預約", "action=my"),
    postback("活動／課程", "action=events"),
    postback("我的票券", "action=tickets"),
    postback("會員／套票", "action=membership"),
    postback("LINE 客服", "action=support"),
    postback("品牌資訊", "action=brand"),
  ];
  return withQuickReplies(brandedCard(context, {
    altText: `${context.clinicName}｜LINE 服務選單`,
    badge: "LINE 服務台",
    title: "今天想先處理哪件事？",
    body: "預約、報名、票券與會員權益，都可以直接從這段對話開始。",
    highlight: ["目前服務品牌", context.clinicName],
    details: [["預約／課程", "從下方快速選項開始"], ["個人服務", "查詢紀錄、票券與套票"]],
    buttons: [
      { label: "立即預約", primary: true, action: { type: "postback", data: "action=booking", displayText: "立即預約" } },
      { label: "查看活動／課程", action: { type: "postback", data: "action=events", displayText: "查看活動／課程" } },
    ],
  }), actions);
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
    await replyMessages(replyToken, [brandedCard(context, {
      altText: `${context.clinicName}｜目前沒有開放預約`,
      badge: "預約服務",
      title: "目前沒有可預約項目",
      body: "品牌尚未開放線上時段；需要協助時，可直接把問題傳給客服。",
      highlight: ["目前狀態", "暫無開放服務"],
      details: [["下一步", "聯絡品牌客服確認"]],
      buttons: [{ label: "聯絡 LINE 客服", primary: true, action: { type: "postback", data: "action=support", displayText: "聯絡 LINE 客服" } }],
    })], context.lineAccessToken);
    return;
  }
  if (lineUserId) {
    await saveLineCustomerSession(context.service, context.clinicId, lineUserId, { intent: "booking", step: "choose_service", context: {} });
  }
  const actions = data.slice(0, 11).map((service) => postback(String(service.name), `action=booking_service&service_id=${encodeURIComponent(String(service.id))}`));
  if (data.length > 11) {
    actions.push({ type: "uri", label: "查看全部服務", uri: serviceUrl(context, "booking", { task: "1" }) });
  }
  const buttons: LineFlexButton[] = data.length > 11
    ? [{ label: "瀏覽全部服務", action: { type: "uri", uri: serviceUrl(context, "booking", { task: "1" }) } }]
    : [];
  await replyMessages(replyToken, [withQuickReplies(brandedCard(context, {
    altText: `${context.clinicName}｜選擇預約服務`,
    badge: "預約 1／2",
    title: "先選一項服務",
    body: "下方選項來自品牌目前開放的服務；選定後會接著安排日期。",
    highlight: ["可預約服務", `${data.length} 項`],
    details: [["選擇方式", "點選聊天視窗下方的服務名稱"], ["接續步驟", "選日期，再查看可用時段"]],
    buttons,
  }), actions)], context.lineAccessToken);
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
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${context.clinicName}｜選擇${service.name}預約日期`,
    badge: "預約 2／2",
    title: "哪一天方便前來？",
    body: "選定日期後，只會顯示這項服務當天真正可預約的時段。",
    highlight: ["已選服務", String(service.name)],
    details: [["可選期間", `${today} 至 ${maxDate}`], ["下一步", "查看當日可用時段"]],
    buttons: [{
      label: "選擇預約日期",
      primary: true,
      action: {
        type: "datetimepicker",
        data: `action=booking_date&service_id=${encodeURIComponent(String(service.id))}`,
        mode: "date",
        initial: today,
        min: today,
        max: maxDate,
      },
    }],
  })], context.lineAccessToken);
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
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${context.clinicName}｜查看${selectedDate}可約時段`,
    badge: "時段已準備",
    title: "接著選擇時間",
    body: "已保留你剛才選擇的服務與日期；開啟後只需選時段並確認資料。",
    highlight: ["預約日期", selectedDate],
    details: [["服務項目", String(service.name)], ["剩餘操作", "選時段・確認資料"]],
    buttons: [{ label: "查看可約時段", primary: true, action: { type: "uri", uri } }],
  })], context.lineAccessToken);
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
    await replyMessages(replyToken, [brandedCard(context, {
      altText: `${context.clinicName}｜目前沒有開放報名`,
      badge: "活動與課程",
      title: "本期尚未開放報名",
      body: "新場次公布後會直接出現在這裡，也可以先查看品牌目前提供的服務。",
      highlight: ["目前狀態", "暫無公開場次"],
      details: [["更新方式", "依品牌最新發布內容即時顯示"]],
      buttons: [{ label: "回到服務選單", primary: true, action: { type: "postback", data: "action=home", displayText: "回到服務選單" } }],
    })], context.lineAccessToken);
    return;
  }
  const bubbles = rows.map((event) => {
    const closeAt = event.registration_close_at
      ? new Date(event.registration_close_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" })
      : "依品牌公告";
    const card = cardContents(brandedCard(context, {
      altText: `${context.clinicName}｜${event.title}`,
      badge: "開放報名",
      title: event.title,
      body: event.description?.trim() || "選擇場次、查看票種與剩餘名額。",
      highlight: ["報名期限", closeAt],
      details: [["內容狀態", "已公開"], ["下一步", "選場次與票種"]],
      buttons: [{ label: "查看場次並報名", primary: true, action: { type: "uri", uri: serviceUrl(context, "events", { event: event.id, task: "1" }) } }],
    }));
    return isHttpsUrl(event.cover_url)
      ? { ...card, hero: { type: "image", url: event.cover_url, size: "full", aspectRatio: "20:11", aspectMode: "cover" } }
      : card;
  });
  await replyMessages(replyToken, [{ type: "flex", altText: `${context.clinicName}｜目前開放報名`, contents: { type: "carousel", contents: bubbles } }], context.lineAccessToken);
}

function accountLinkUrl(context: LineCustomerJourneyContext, linkToken: string): string {
  const url = new URL("/line/account-link", context.baseUrl);
  if (context.clinicSlug) url.searchParams.set("clinic_slug", context.clinicSlug);
  url.searchParams.set("linkToken", linkToken);
  return url.toString();
}

async function replyAccountLinkPrompt(replyToken: string, lineUserId: string, context: LineCustomerJourneyContext): Promise<void> {
  const linkToken = await issueLineAccountLinkToken(lineUserId, context.lineAccessToken);
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${context.clinicName}｜綁定 LINE 會員資料`,
    badge: "會員身分驗證",
    title: "把既有會員資料連回 LINE",
    body: "只需驗證一次；完成後即可直接查詢預約、電子票券與會員權益。",
    highlight: ["驗證資料", "姓名・電話・生日"],
    details: [["資料範圍", "只綁定目前品牌"], ["連結效期", "一次性使用・10 分鐘"]],
    buttons: [{ label: "開始安全綁定", primary: true, action: { type: "uri", uri: accountLinkUrl(context, linkToken) } }],
  })], context.lineAccessToken);
}

export function lineAccountLinkedMessage(context: LineBranding, patientName?: string | null): LineMessage {
  return brandedCard(context, {
    altText: `${context.clinicName}｜LINE 會員綁定完成`,
    badge: "綁定完成",
    title: patientName ? `${patientName}，歡迎回來` : "會員身分已連結",
    body: "之後可直接從官方帳號查看個人預約、票券、套票與會員權益。",
    highlight: ["目前狀態", "LINE 會員身分已啟用"],
    details: [["預約紀錄", "可直接查詢與改期"], ["會員權益", "票券・套票・剩餘堂數"]],
    buttons: [
      { label: "查看會員套票", primary: true, action: { type: "postback", data: "action=membership", displayText: "查看會員套票" } },
      { label: "查看我的票券", action: { type: "postback", data: "action=tickets", displayText: "查看我的票券" } },
    ],
  });
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
    await replyMessages(replyToken, [brandedCard(context, {
      altText: `${context.clinicName}｜目前沒有可用票券`,
      badge: "我的票券",
      title: "目前沒有可使用票券",
      body: "完成活動或課程報名後，電子票券與報到入口會集中顯示在這裡。",
      highlight: ["票券數量", "0 張"],
      details: [["取得方式", "完成活動／課程報名"]],
      buttons: [{ label: "查看開放活動", primary: true, action: { type: "postback", data: "action=events", displayText: "查看開放活動" } }],
    })], context.lineAccessToken);
    return;
  }
  const bubbles = rows.map((row) => {
    const event = one(row.events);
    const session = one(row.event_sessions);
    const date = session?.start_at ? new Date(session.start_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "待確認";
    return cardContents(brandedCard(context, {
      altText: `${context.clinicName}｜${event?.title ?? "活動票券"}｜${date}`,
      badge: registrationStatus(row.status),
      title: event?.title ?? "活動票券",
      body: "報到時請開啟完整票券頁，出示該場次的動態 QR。",
      highlight: ["日期時間", date],
      details: [["場次", session?.name ?? "待確認"], ["報名編號", row.registration_no], ["付款狀態", paymentStatus(row.payment_status)]],
      buttons: [{ label: "開啟票券與報到碼", primary: true, action: { type: "uri", uri: serviceUrl(context, "tickets", { task: "1" }) } }],
    }));
  });
  await replyMessages(replyToken, [{ type: "flex", altText: `${context.clinicName}｜我的票券`, contents: { type: "carousel", contents: bubbles } }], context.lineAccessToken);
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
    await replyMessages(replyToken, [brandedCard(context, {
      altText: `${context.clinicName}｜目前沒有使用中套票`,
      badge: "會員權益",
      title: "目前沒有使用中的套票",
      body: "可先查看品牌提供的方案；購買或綁定後，剩餘堂數與期限會顯示在這裡。",
      highlight: ["使用中方案", "0 組"],
      details: [["可使用範圍", "依各方案說明"]],
      buttons: [{ label: "查看可購買方案", primary: true, action: { type: "uri", uri: serviceUrl(context, "membership", { task: "1" }) } }],
    })], context.lineAccessToken);
    return;
  }
  const contents = rows.map((row) => cardContents(brandedCard(context, {
    altText: `${context.clinicName}｜${one(row.membership_plans)?.name ?? "會員套票"}｜剩餘 ${row.credits_remaining} 堂`,
    badge: membershipStatus(row.status),
    title: one(row.membership_plans)?.name ?? "會員套票",
    body: "堂數、有效期限與使用紀錄都會依實際交易即時更新。",
    highlight: ["剩餘可用", `${row.credits_remaining}／${row.credits_total} 堂`],
    details: [["會員編號", row.membership_code], ["有效期限", row.expires_at ? new Date(row.expires_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) : "不限期"]],
    buttons: [
      { label: "查看完整會員權益", primary: true, action: { type: "uri", uri: serviceUrl(context, "membership", { task: "1" }) } },
      { label: "解除這個品牌的綁定", action: { type: "postback", data: "action=unlink_account", displayText: "解除會員綁定" } },
    ],
  })));
  await replyMessages(replyToken, [{ type: "flex", altText: `${context.clinicName}｜會員與套票`, contents: { type: "carousel", contents } }], context.lineAccessToken);
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
  const buttons: LineFlexButton[] = [{ label: "瀏覽品牌形象網站", primary: true, action: { type: "uri", uri: customerEntryUrl("home", { baseUrl: context.baseUrl, clinicSlug: context.clinicSlug, liffId: null, preferLiff: false }) } }];
  if (clinic?.phone) buttons.push({ label: "直接撥打電話", action: { type: "uri", uri: `tel:${clinic.phone.replace(/[^+\d]/g, "")}` } });
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${clinic?.name ?? context.clinicName}｜品牌資訊`,
    badge: "品牌資訊",
    title: clinic?.name ?? context.clinicName,
    body: clinic?.intro?.trim() || "查看品牌服務、聯絡方式與最新公告。",
    highlight: ["服務入口", "官方品牌網站"],
    details: [["電話", clinic?.phone ?? "請透過 LINE 洽詢"], ["地址", clinic?.address ?? "依服務通知"]],
    buttons,
  })], context.lineAccessToken);
}

export async function startLineSupport(replyToken: string, lineUserId: string | undefined, context: LineCustomerJourneyContext): Promise<void> {
  if (!lineUserId) throw new Error("無法取得 LINE 身分");
  await saveLineCustomerSession(context.service, context.clinicId, lineUserId, { intent: "support", step: "waiting_message", context: {} }, 30);
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${context.clinicName}｜LINE 客服已連線`,
    badge: "客服對話中",
    title: "請直接輸入想詢問的內容",
    body: "你的下一則文字會送到品牌客服後台；離線時也會保留，不需要重複傳送。",
    highlight: ["目前狀態", "等待你的問題"],
    details: [["回覆位置", "直接回到這個 LINE 對話"], ["結束方式", "點下方按鈕結束客服模式"]],
    buttons: [{ label: "結束客服對話", action: { type: "postback", data: "action=support_end", displayText: "結束客服" } }],
  })], context.lineAccessToken);
}

export async function endLineSupport(replyToken: string, lineUserId: string | undefined, context: LineCustomerJourneyContext): Promise<void> {
  if (lineUserId) await clearLineCustomerSession(context.service, context.clinicId, lineUserId);
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${context.clinicName}｜客服對話已結束`,
    badge: "客服已結束",
    title: "這次對話已完成",
    body: "需要預約、查詢票券或再次聯絡客服時，可隨時回到服務選單。",
    highlight: ["目前狀態", "一般服務模式"],
    details: [["下一步", "選擇其他需要辦理的事項"]],
    buttons: [{ label: "回到服務選單", primary: true, action: { type: "postback", data: "action=home", displayText: "回到服務選單" } }],
  })], context.lineAccessToken);
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
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${context.clinicName}｜客服訊息已送達`,
    badge: open ? "客服已收到" : "離線留言已保留",
    title: open ? "訊息已交給客服" : "留言已安全保留",
    body: message,
    highlight: ["案件狀態", open ? "等待客服回覆" : "等待服務時間處理"],
    details: [["回覆位置", "同一個 LINE 對話"]],
    buttons: [{ label: "結束客服對話", action: { type: "postback", data: "action=support_end", displayText: "結束客服" } }],
  })], context.lineAccessToken);
  return true;
}

export function lineAccountLinkConfirmation(context: LineBranding): LineMessage {
  return brandedCard(context, {
    altText: `${context.clinicName}｜確認解除 LINE 會員綁定`,
    badge: "需要確認",
    title: "要解除會員綁定嗎？",
    body: "解除後，這個 LINE 帳號將無法直接查詢目前品牌的預約、票券與會員權益。",
    highlight: ["影響範圍", "只解除目前品牌"],
    details: [["其他品牌", "不受影響"], ["再次使用", "需要重新驗證會員資料"]],
    buttons: [
      { label: "保留目前綁定", primary: true, action: { type: "postback", data: "action=home", displayText: "保留會員綁定" } },
      { label: "確認解除綁定", action: { type: "postback", data: "action=unlink_confirm", displayText: "確認解除會員綁定" } },
    ],
  });
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
