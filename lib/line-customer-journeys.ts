import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { customerEntryUrl } from "@/lib/customer-entry";
import { issueLineAccountLinkToken, replyMessages, type LineMessage } from "@/lib/line";
import { getLineCustomerIdentity } from "@/lib/line-customer-identity";
import { clearLineCustomerSession, getLineCustomerSession, saveLineCustomerSession } from "@/lib/line-session";
import { isClinicOpenNow } from "@/lib/queue";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { buildLineExperienceCard, lineBrandTheme, type LineBrandTheme, type LineFlexButton } from "@/lib/line-ui-templates";
import { lineFlexDesignForDelivery, type LineFlexTemplateKey } from "@/lib/line-flex-design";

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
  lineFlexDesigns?: unknown;
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
const LINE_CALENDAR_DAYS = 30;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

interface BookingCalendarDay {
  date: string;
  remaining: number;
}

function addTaipeiDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return TAIPEI_DATE.format(date);
}

function weekdayIndex(value: string): number {
  const sundayFirst = new Date(`${value}T12:00:00+08:00`).getUTCDay();
  return (sundayFirst + 6) % 7;
}

function calendarRangeLabel(start: string, end: string): string {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  if (startYear === endYear && startMonth === endMonth) return `${startYear} 年 ${startMonth} 月 ${startDay}–${endDay} 日`;
  if (startYear === endYear) return `${startYear} 年 ${startMonth}/${startDay}–${endMonth}/${endDay}`;
  return `${startYear}/${startMonth}/${startDay}–${endYear}/${endMonth}/${endDay}`;
}

function bookingCalendarMessage(context: LineBranding, input: {
  serviceId: string;
  serviceName: string;
  doctorId: string | null;
  doctorName: string | null;
  bookingMode: "time" | "number";
  today: string;
  maxDate: string;
  days: BookingCalendarDay[];
}): LineMessage {
  const theme = themeFor(context);
  const start = input.days[0]?.date ?? input.today;
  const end = input.days.at(-1)?.date ?? start;
  const blanksBefore = weekdayIndex(start);
  const cells: Array<BookingCalendarDay | null> = [
    ...Array.from({ length: blanksBefore }, () => null),
    ...input.days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, rowIndex) => cells.slice(rowIndex * 7, rowIndex * 7 + 7));
  const doctorParam = input.doctorId ? `&doctor_id=${encodeURIComponent(input.doctorId)}` : "";
  const availableDates = input.days.filter((day) => day.remaining > 0).length;
  const nearlyFullDates = input.days.filter((day) => day.remaining > 0 && day.remaining <= 2).length;
  const openDates = availableDates - nearlyFullDates;
  const fullDates = input.days.length - availableDates;
  const previousStart = addTaipeiDays(start, -LINE_CALENDAR_DAYS) < input.today ? input.today : addTaipeiDays(start, -LINE_CALENDAR_DAYS);
  const nextStart = addTaipeiDays(end, 1);
  const navigation: Array<Record<string, unknown>> = [];
  if (start > input.today) {
    navigation.push({
      type: "button",
      height: "sm",
      style: "secondary",
      action: {
        type: "postback",
        label: "查看前 30 天",
        data: `action=booking_calendar&service_id=${encodeURIComponent(input.serviceId)}${doctorParam}&start=${previousStart}`,
        displayText: "查看前 30 天預約狀況",
      },
    });
  }
  if (nextStart <= input.maxDate) {
    navigation.push({
      type: "button",
      height: "sm",
      style: "secondary",
      action: {
        type: "postback",
        label: "查看後 30 天",
        data: `action=booking_calendar&service_id=${encodeURIComponent(input.serviceId)}${doctorParam}&start=${nextStart}`,
        displayText: "查看後 30 天預約狀況",
      },
    });
  }
  navigation.push({
    type: "button",
    height: "sm",
    style: "secondary",
    action: {
      type: "datetimepicker",
      label: "用日期選擇器查看其它日期",
      data: `action=booking_date&service_id=${encodeURIComponent(input.serviceId)}${doctorParam}`,
      mode: "date",
      initial: start,
      min: input.today,
      max: input.maxDate,
    },
  });

  const dateRows = rows.map((row) => ({
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    contents: row.map((day) => {
      if (!day) return { type: "box", layout: "vertical", flex: 1, height: "54px", contents: [{ type: "filler" }] };
      const available = day.remaining > 0;
      const limited = available && day.remaining <= 2;
      const stateLabel = !available ? "額滿" : limited ? "即將額滿" : "尚可預約";
      const [, month, date] = day.date.split("-");
      return {
        type: "box",
        layout: "vertical",
        flex: 1,
        height: "46px",
        justifyContent: "center",
        paddingAll: "4px",
        cornerRadius: "8px",
        backgroundColor: available ? (limited ? "#FFF4DC" : theme.soft) : "#F1F2F1",
        ...(day.date === input.today ? { borderWidth: "2px", borderColor: theme.accent } : {}),
        ...(available ? {
          action: {
            type: "postback",
            label: `${month}/${date}`,
            data: `action=booking_date&service_id=${encodeURIComponent(input.serviceId)}${doctorParam}&date=${day.date}`,
            displayText: `選擇 ${month}/${date}`,
          },
        } : {}),
        contents: [
          { type: "text", text: `${Number(month)}/${Number(date)}`, size: "xs", weight: "bold", color: available ? theme.ink : "#98A09C", align: "center", scaling: true },
          { type: "text", text: stateLabel, size: "xxs", color: available ? theme.primary : "#7C8581", align: "center", margin: "xs", scaling: true, adjustMode: "shrink-to-fit" },
        ],
      };
    }),
  }));

  return {
    type: "flex",
    altText: `${context.clinicName}｜${input.serviceName}｜近 30 天預約月曆｜尚可預約 ${openDates} 天・即將額滿 ${nearlyFullDates} 天・額滿 ${fullDates} 天`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: theme.primary,
        paddingAll: "18px",
        contents: [
          { type: "box", layout: "horizontal", contents: [
            { type: "text", text: context.clinicName, color: "#FFFFFF", size: "xs", weight: "bold", flex: 1, wrap: true, scaling: true },
            { type: "text", text: "預約日期", color: "#FFFFFF", size: "xxs", weight: "bold", align: "end", flex: 0, scaling: true },
          ] },
          { type: "text", text: "選擇預約日期", color: "#FFFFFF", size: "xl", weight: "bold", margin: "lg", scaling: true },
          { type: "text", text: `${input.serviceName}${input.doctorName ? `・${input.doctorName}` : ""}`, color: "#FFFFFF", size: "sm", wrap: true, margin: "sm", scaling: true },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: [
          { type: "text", text: `近 30 天・${calendarRangeLabel(start, end)}`, color: theme.ink, size: "md", weight: "bold", align: "center", scaling: true },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            spacing: "sm",
            contents: [
              { type: "text", text: `尚可預約 ${openDates}`, color: theme.primary, size: "xxs", weight: "bold", align: "center", flex: 1, scaling: true },
              { type: "text", text: `即將額滿 ${nearlyFullDates}`, color: "#9A6415", size: "xxs", weight: "bold", align: "center", flex: 1, scaling: true },
              { type: "text", text: `額滿 ${fullDates}`, color: "#7C8581", size: "xxs", weight: "bold", align: "center", flex: 1, scaling: true },
            ],
          },
          { type: "box", layout: "horizontal", margin: "lg", spacing: "xs", contents: WEEKDAY_LABELS.map((label) => ({ type: "text", text: label, size: "xxs", color: "#7B8580", align: "center", flex: 1, weight: "bold", scaling: true })) },
          { type: "box", layout: "vertical", margin: "sm", spacing: "xs", contents: dateRows },
          { type: "text", text: input.bookingMode === "number" ? "狀態依目前剩餘名額即時更新" : "狀態依目前可選時段即時更新", color: "#7B8580", size: "xxs", align: "center", margin: "lg", scaling: true },
        ],
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px", backgroundColor: "#FAFBFA", contents: navigation },
      styles: { footer: { separator: true, separatorColor: "#E5E9E7" } },
    },
  };
}

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

type LineBranding = Pick<LineCustomerJourneyContext, "clinicName" | "baseUrl" | "brandTemplate" | "brandPrimaryColor" | "brandAccentColor" | "lineFlexDesigns">;

function themeFor(context: LineBranding): LineBrandTheme {
  return lineBrandTheme(context.brandTemplate, context.brandPrimaryColor, context.brandAccentColor);
}

function lineFlexKeyForCard(input: { badge: string; title: string; body: string; highlight: [string, string] }): LineFlexTemplateKey {
  const content = `${input.badge} ${input.title} ${input.body} ${input.highlight[0]}`;
  if (/付款|訂金|待付/.test(content)) return "payment_pending";
  if (/提醒|快到了/.test(content)) return "appointment_reminder";
  if (/候補名額|需要你的確認/.test(content)) return "waitlist_offer";
  if (/候補|順位/.test(content)) return "waitlist_joined";
  if (/票券|QR/.test(content)) return "ticket_ready";
  if (/報名|活動|課程/.test(content)) return "registration_confirmed";
  if (/會員綁定|啟用 LINE 會員|連結會員/.test(content)) return "account_link";
  if (/會員|套票|權益|餘額/.test(content)) return "membership_balance";
  if (/客服|案件|對話/.test(content)) return "support_handoff";
  if (/改期|取消|更新|失效/.test(content)) return "appointment_changed";
  if (/再次預約|上次服務/.test(content)) return "quick_rebook";
  if (/選擇.*服務|服務選單|想先辦理/.test(content)) return "booking_service_select";
  return "booking_confirmed";
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
    design: lineFlexDesignForDelivery(context.lineFlexDesigns, lineFlexKeyForCard(input), context.baseUrl),
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
  requestedDoctorId?: string | null,
  requestedStart?: string | null,
): Promise<void> {
  if (!serviceId) throw new Error("缺少服務");
  const [{ data: service, error: serviceError }, { data: settings, error: settingsError }] = await Promise.all([
    context.service.from("services").select("id, name, booking_target").eq("clinic_id", context.clinicId).eq("id", serviceId).eq("active", true).maybeSingle(),
    context.service.from("clinic_settings").select("max_advance_days, booking_mode, public_booking_enabled").eq("clinic_id", context.clinicId).maybeSingle(),
  ]);
  if (serviceError || settingsError) throw new Error(serviceError?.message ?? settingsError?.message ?? "服務讀取失敗");
  if (!service) {
    await replyMessages(replyToken, [{ type: "text", text: "這項服務目前未開放，請重新選擇。" }], context.lineAccessToken);
    return;
  }
  if (settings?.public_booking_enabled === false) {
    await replyMessages(replyToken, [brandedCard(context, {
      altText: `${context.clinicName}｜目前暫停線上預約`,
      badge: "預約服務",
      title: "目前暫停線上預約",
      body: "品牌暫時沒有開放線上日期，需要協助時可直接聯絡客服。",
      highlight: ["目前狀態", "尚未開放日期"],
      details: [["服務項目", String(service.name)]],
      buttons: [{ label: "聯絡 LINE 客服", primary: true, action: { type: "postback", data: "action=support", displayText: "聯絡 LINE 客服" } }],
    })], context.lineAccessToken);
    return;
  }

  let doctorId = requestedDoctorId?.trim() || null;
  let doctorName: string | null = null;
  if (service.booking_target === "provider_required") {
    const { data: doctors, error: doctorsError } = await context.service
      .from("doctors")
      .select("id, name")
      .eq("clinic_id", context.clinicId)
      .eq("active", true)
      .order("name")
      .limit(50);
    if (doctorsError) throw new Error(doctorsError.message);
    const availableDoctors = doctors ?? [];
    const selectedDoctor = doctorId ? availableDoctors.find((doctor) => String(doctor.id) === doctorId) : null;
    if (doctorId && !selectedDoctor) throw new Error("服務人員不存在或已停用");
    if (!doctorId && availableDoctors.length === 1) doctorId = String(availableDoctors[0].id);
    if (!doctorId && availableDoctors.length > 1) {
      const actions = availableDoctors.slice(0, 10).map((doctor) => postback(
        String(doctor.name),
        `action=booking_provider&service_id=${encodeURIComponent(String(service.id))}&doctor_id=${encodeURIComponent(String(doctor.id))}`,
      ));
      if (availableDoctors.length > 10) actions.push({ type: "uri", label: "查看全部人員", uri: serviceUrl(context, "booking", { service_id: String(service.id), task: "1" }) });
      await replyMessages(replyToken, [withQuickReplies(brandedCard(context, {
        altText: `${context.clinicName}｜選擇${service.name}服務人員`,
        badge: "預約 2／3",
        title: "想由哪位服務人員安排？",
        body: "先選擇服務人員，下一則訊息會顯示他的可預約日期。",
        highlight: ["已選服務", String(service.name)],
        details: [["服務人員", `${availableDoctors.length} 位可選`], ["下一步", "查看兩週預約月曆"]],
        buttons: availableDoctors.length > 10 ? [{ label: "瀏覽全部人員", action: { type: "uri", uri: serviceUrl(context, "booking", { service_id: String(service.id), task: "1" }) } }] : [],
      }), actions)], context.lineAccessToken);
      return;
    }
    if (!doctorId) {
      await replyMessages(replyToken, [brandedCard(context, {
        altText: `${context.clinicName}｜目前沒有可安排的服務人員`,
        badge: "預約服務",
        title: "目前沒有可安排的人員",
        body: "這項服務需要指定服務人員，但品牌目前尚未開放人員排程。",
        highlight: ["已選服務", String(service.name)],
        details: [["下一步", "聯絡客服協助安排"]],
        buttons: [{ label: "聯絡 LINE 客服", primary: true, action: { type: "postback", data: "action=support", displayText: "聯絡 LINE 客服" } }],
      })], context.lineAccessToken);
      return;
    }
    doctorName = String((selectedDoctor ?? availableDoctors.find((doctor) => String(doctor.id) === doctorId))?.name ?? "服務人員");
  } else {
    doctorId = null;
  }

  const today = TAIPEI_DATE.format(new Date());
  const maxDate = addTaipeiDays(today, Math.max(1, Number(settings?.max_advance_days ?? 30)));
  const start = requestedStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) && requestedStart >= today && requestedStart <= maxDate
    ? requestedStart
    : today;
  const dates: string[] = [];
  for (let index = 0; index < LINE_CALENDAR_DAYS; index += 1) {
    const date = addTaipeiDays(start, index);
    if (date > maxDate) break;
    dates.push(date);
  }
  const bookingMode = settings?.booking_mode === "number" ? "number" : "time";
  const days = await Promise.all(dates.map(async (date): Promise<BookingCalendarDay> => {
    const rpcName = bookingMode === "number"
      ? doctorId ? "get_available_sessions_for_service" : "get_available_service_sessions"
      : doctorId ? "get_available_slots_for_service" : "get_available_service_slots";
    const args = bookingMode === "number"
      ? doctorId
        ? { p_clinic_id: context.clinicId, p_doctor_id: doctorId, p_date: date, p_service_id: String(service.id) }
        : { p_clinic_id: context.clinicId, p_service_id: String(service.id), p_date: date }
      : doctorId
        ? { p_clinic_id: context.clinicId, p_doctor_id: doctorId, p_date: date, p_visit_type: "return", p_service_id: String(service.id) }
        : { p_clinic_id: context.clinicId, p_service_id: String(service.id), p_date: date, p_visit_type: "return", p_doctor_id: null };
    const { data, error } = await context.service.rpc(rpcName, args);
    if (error) throw new Error(error.message);
    const remaining = ((data ?? []) as Array<{ remaining?: number | string | null }>).reduce(
      (sum, row) => sum + Math.max(0, Number(row.remaining ?? 0)),
      0,
    );
    return { date, remaining };
  }));
  if (lineUserId) {
    await saveLineCustomerSession(context.service, context.clinicId, lineUserId, {
      intent: "booking",
      step: "choose_date",
      context: { service_id: String(service.id), ...(doctorId ? { doctor_id: doctorId } : {}) },
    });
  }
  await replyMessages(replyToken, [bookingCalendarMessage(context, {
    serviceId: String(service.id),
    serviceName: String(service.name),
    doctorId,
    doctorName,
    bookingMode,
    today,
    maxDate,
    days,
  })], context.lineAccessToken);
}

export async function replyBookingContinue(
  replyToken: string,
  lineUserId: string | undefined,
  serviceId: string | null,
  selectedDate: string | undefined,
  context: LineCustomerJourneyContext,
  doctorId?: string | null,
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
      context: { service_id: String(service.id), date: selectedDate, ...(doctorId ? { doctor_id: doctorId } : {}) },
    });
  }
  const uri = serviceUrl(context, "booking", { service_id: String(service.id), date: selectedDate, ...(doctorId ? { doctor_id: doctorId } : {}), task: "1" });
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
  url.searchParams.set("mode", "existing");
  return url.toString();
}

async function replyAccountLinkPrompt(replyToken: string, lineUserId: string, context: LineCustomerJourneyContext): Promise<void> {
  const linkToken = await issueLineAccountLinkToken(lineUserId, context.lineAccessToken).catch(() => null);
  await replyMessages(replyToken, [brandedCard(context, {
    altText: `${context.clinicName}｜綁定 LINE 會員資料`,
    badge: "會員服務",
    title: "啟用 LINE 會員",
    body: "直接使用目前這個 LINE 帳號完成綁定，不需要離開聊天室。",
    highlight: ["綁定方式", "LINE 內一鍵完成"],
    details: [["個人資料", "需要預約或付款時再補"]],
    buttons: [
      { label: "直接綁定目前 LINE", primary: true, action: { type: "postback", data: "action=bind_member", displayText: "啟用 LINE 會員" } },
      ...(linkToken ? [{ label: "找回品牌既有會員", action: { type: "uri" as const, uri: accountLinkUrl(context, linkToken) } }] : []),
    ],
  })], context.lineAccessToken);
}

export function lineNativeMemberLinkedMessage(context: LineBranding, displayName?: string | null): LineMessage {
  return brandedCard(context, {
    altText: `${context.clinicName}｜LINE 會員已啟用`,
    badge: "綁定完成",
    title: displayName ? `${displayName}，LINE 會員已啟用` : "LINE 會員已啟用",
    body: "已綁定目前 LINE 帳號。電話與生日會在預約、付款等真正需要時再請你補充。",
    highlight: ["目前狀態", "已綁定這個品牌"],
    details: [["操作位置", "繼續留在 LINE 使用"]],
    buttons: [
      { label: "查看會員／套票", primary: true, action: { type: "postback", data: "action=membership", displayText: "查看會員／套票" } },
      { label: "回到服務選單", action: { type: "postback", data: "action=home", displayText: "回到服務選單" } },
    ],
  });
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
    const [{ count }, identity] = await Promise.all([
      context.service.from("patients").select("id", { count: "exact", head: true }).eq("clinic_id", context.clinicId).eq("line_user_id", lineUserId).eq("active", true),
      getLineCustomerIdentity(context.service, context.clinicId, lineUserId),
    ]);
    if (!count && !identity) return replyAccountLinkPrompt(replyToken, lineUserId, context);
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
  if (!patientIds.length) {
    const identity = await getLineCustomerIdentity(context.service, context.clinicId, lineUserId);
    if (!identity) return replyAccountLinkPrompt(replyToken, lineUserId, context);
    await replyMessages(replyToken, [brandedCard(context, {
      altText: `${context.clinicName}｜LINE 會員已啟用`,
      badge: "會員權益",
      title: "LINE 會員已啟用",
      body: "目前沒有使用中的套票；需要個人資料時，系統會在操作當下再請你補充。",
      highlight: ["使用中方案", "0 組"],
      details: [["LINE 身分", "已完成綁定"]],
      buttons: [{ label: "查看可購買方案", primary: true, action: { type: "uri", uri: serviceUrl(context, "membership", { task: "1" }) } }],
    })], context.lineAccessToken);
    return;
  }
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
