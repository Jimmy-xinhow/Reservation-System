import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { verifyLineSignature, replyMessages, lineCredentialsForDestination } from "@/lib/line";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { buildMessageById, menuMessage, replyMyAppointments, replyProgress, welcomeMessage, type MenuConfig } from "@/lib/line-webhook-messages";
import { safeReply } from "@/lib/line-webhook-reply";
import { handleStatusPostback } from "@/lib/line-webhook-status";
import { recordLineAttendance } from "@/lib/attendance";
import {
  endLineSupport,
  handleLineSupportText,
  lineAccountLinkConfirmation,
  lineAccountLinkedMessage,
  lineNativeMemberLinkedMessage,
  lineHomeMessage,
  replyBookingContinue,
  replyBookingDatePrompt,
  replyBookingServices,
  replyBrandInfo,
  replyEvents,
  replyLineHome,
  replyMemberships,
  replyTickets,
  startLineSupport,
  type LineCustomerJourneyContext,
} from "@/lib/line-customer-journeys";
import { ensureLineCustomerIdentity } from "@/lib/line-customer-identity";
import { handleLineStaffCommand } from "@/lib/line-staff-journeys";
import { claimLineWebhookEvent, finishLineWebhookEvent } from "@/lib/line-session";
import { resetLineAudienceMenu, syncLineAudienceMenu } from "@/lib/line-audience-menu";
import { publicRequestOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string; params?: { date?: string; time?: string; datetime?: string } };
  link?: { result?: "ok" | "failed"; nonce?: string };
}

interface LineWebhookBody {
  destination?: string;
  events?: LineEvent[];
}

/**
 * POST /api/line/webhook
 * 驗 x-line-signature 後處理:
 *  - follow:加好友歡迎訊息
 *  - message(text):選單自動回覆 / 關鍵字(預約、查詢)
 *  - postback:confirm/cancel(提醒按鈕)、my(查詢我的預約)
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-line-signature");
  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(raw) as LineWebhookBody;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const destination = payload.destination?.trim() || undefined;
  const svc = createServiceClient();
  let lineCredentials: Awaited<ReturnType<typeof lineCredentialsForDestination>>;
  try {
    lineCredentials = await lineCredentialsForDestination(destination, svc);
  } catch {
    return new Response("brand LINE credentials unavailable", { status: 503 });
  }
  if (!verifyLineSignature(raw, signature, lineCredentials.channelSecret)) {
    return new Response("invalid signature", { status: 401 });
  }
  if (!lineCredentials.accessToken) {
    return new Response("brand LINE access token unavailable", { status: 503 });
  }
  const events = payload.events ?? [];

  const baseUrl = publicRequestOrigin(req.nextUrl.origin);

  const { data: destinationClinic } = destination
     ? await svc.from("clinics").select("id, slug, name").eq("line_destination", destination).eq("active", true).maybeSingle()
    : CLINIC_ID
       ? await svc.from("clinics").select("id, slug, name").eq("id", CLINIC_ID).eq("active", true).maybeSingle()
      : { data: null };
  if (destination && !destinationClinic?.id) return new Response("brand destination not configured", { status: 404 });
  const clinicId = (destinationClinic?.id as string | undefined) || CLINIC_ID;
  if (!clinicId) return new Response("brand not configured", { status: 500 });
  const clinicSlug = (destinationClinic?.slug as string | null) ?? null;
  const clinicName = (destinationClinic?.name as string | null)?.trim() || "預約與報名平台";
  const lineContext = await getClinicLineChannelContext(svc, clinicId);
  if (!lineContext.enabled) return new Response("brand LINE channel disabled", { status: 404 });
  const liffId = lineContext.liffId;
  const lineAccessToken = lineCredentials.accessToken;

  // 讀取後台自訂的回覆規則與歡迎/預設文字
  const [{ data: rules }, { data: cs }] = await Promise.all([
    svc
      .from("line_auto_replies")
      .select("keywords, action, reply_text, message_id")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("sort"),
    svc
      .from("clinic_settings")
      .select(
        "line_welcome_text, line_fallback_text, line_menu_title, line_menu_btn_booking, line_menu_btn_query, line_menu_btn_progress, line_menu_btn_info, line_menu_link_label, line_menu_link_url, legacy_progress_enabled, brand_page_template, brand_primary_color, brand_accent_color",
      )
      .eq("clinic_id", clinicId)
      .maybeSingle(),
  ]);
  const replyRules = (rules ?? []) as {
    keywords: string;
    action: string;
    reply_text: string | null;
    message_id: string | null;
  }[];
  const welcomeText = cs?.line_welcome_text || null;
  const fallbackText = cs?.line_fallback_text || null;
  const menuCfg: MenuConfig = {
    title: cs?.line_menu_title || null,
    booking: cs?.line_menu_btn_booking ?? true,
    query: cs?.line_menu_btn_query ?? true,
    progress: cs?.legacy_progress_enabled === true && cs?.line_menu_btn_progress !== false,
    info: cs?.line_menu_btn_info ?? true,
    linkLabel: cs?.line_menu_link_label || null,
    linkUrl: cs?.line_menu_link_url || null,
  };

  const journeyContext: LineCustomerJourneyContext = {
    service: svc,
    clinicId,
    clinicSlug,
    clinicName,
    liffId,
    baseUrl,
    lineAccessToken,
    brandTemplate: (cs?.brand_page_template as string | null) ?? null,
    brandPrimaryColor: (cs?.brand_primary_color as string | null) ?? null,
    brandAccentColor: (cs?.brand_accent_color as string | null) ?? null,
  };

  for (const ev of events) {
    if (!ev.replyToken) continue;
    let claimed = false;
    try {
      claimed = await claimLineWebhookEvent(svc, clinicId, ev.webhookEventId, ev.type);
      if (!claimed) continue;
      if (ev.type === "follow") {
        await replyMessages(ev.replyToken, [welcomeMessage(baseUrl, welcomeText, menuCfg, liffId, clinicSlug, clinicName, journeyContext)], lineAccessToken);
      } else if (ev.type === "accountLink") {
        if (ev.link?.result !== "ok" || !ev.link.nonce || !ev.source?.userId) {
          await safeReply(ev.replyToken, "會員綁定未完成，請回到選單重新操作。", lineAccessToken);
        } else {
          const { data, error } = await svc.rpc("complete_line_account_link", {
            p_clinic_id: clinicId,
            p_nonce: ev.link.nonce,
            p_line_user_id: ev.source.userId,
          });
          if (error) throw new Error(error.message);
          await syncLineAudienceMenu(svc, clinicId, ev.source.userId, "member", lineAccessToken).catch(() => false);
          const linked = Array.isArray(data) ? data[0] : data;
          await ensureLineCustomerIdentity(svc, {
            clinicId,
            lineUserId: ev.source.userId,
            lineAccessToken,
          });
          await replyMessages(ev.replyToken, [lineAccountLinkedMessage(journeyContext, linked?.patient_name as string | null | undefined)], lineAccessToken);
        }
      } else if (ev.type === "message" && ev.message?.type === "text") {
        await (async () => {
        if (!ev.replyToken || !ev.message) return;
        const text = (ev.message.text ?? "").trim();
        if (text === "上班打卡" || text === "下班打卡") {
          const result = await recordLineAttendance(svc, {
            clinicId,
            lineUserId: ev.source?.userId,
            eventType: text === "上班打卡" ? "clock_in" : "clock_out",
            lineEventId: ev.webhookEventId,
          });
          await safeReply(ev.replyToken, result.message, lineAccessToken);
          return;
        }
        if (await handleLineStaffCommand(ev.replyToken, ev.source?.userId, text, journeyContext)) return;
        if (text === "結束客服") {
          await endLineSupport(ev.replyToken, ev.source?.userId, journeyContext);
          return;
        }
        if (text === "選單" || text === "主選單" || text === "首頁") {
          await replyLineHome(ev.replyToken, journeyContext);
          return;
        }
        if (text === "預約" || text === "立即預約") {
          await replyBookingServices(ev.replyToken, ev.source?.userId, journeyContext);
          return;
        }
        if (["我的預約", "查詢預約", "預約查詢"].includes(text)) {
          await replyMyAppointments(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken, journeyContext);
          return;
        }
        if (["活動", "課程", "活動課程", "課程報名"].includes(text)) {
          await replyEvents(ev.replyToken, journeyContext);
          return;
        }
        if (["票券", "我的票券"].includes(text)) {
          await replyTickets(ev.replyToken, ev.source?.userId, journeyContext);
          return;
        }
        if (["會員", "套票", "會員套票"].includes(text)) {
          await replyMemberships(ev.replyToken, ev.source?.userId, journeyContext);
          return;
        }
        if (["客服", "LINE客服", "聯絡客服"].includes(text)) {
          await startLineSupport(ev.replyToken, ev.source?.userId, journeyContext);
          return;
        }
        if (["品牌", "品牌資訊", "聯絡我們"].includes(text)) {
          await replyBrandInfo(ev.replyToken, journeyContext);
          return;
        }
        if (await handleLineSupportText(ev.replyToken, ev.source?.userId, text, journeyContext)) return;
        // 依後台規則(排序)找第一個命中的關鍵字
        const rule = replyRules.find((r) =>
          r.keywords
            .split(/[,,、\s]+/)
            .map((k) => k.trim())
            .filter(Boolean)
            .some((k) => text.includes(k)),
        );
        if (rule?.action === "progress" && menuCfg.progress) {
          await replyProgress(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken);
        } else if (rule?.action === "query") {
          await replyMyAppointments(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken, journeyContext);
        } else if (rule?.action === "booking") {
          await replyBookingServices(ev.replyToken, ev.source?.userId, journeyContext);
        } else if (rule?.action === "message" && rule.message_id) {
          const msg = await buildMessageById(svc, rule.message_id, baseUrl, clinicId, liffId, clinicSlug);
          if (msg) await replyMessages(ev.replyToken, [msg], lineAccessToken);
          else await replyMessages(ev.replyToken, [menuMessage(baseUrl, fallbackText, menuCfg, liffId, clinicSlug, clinicName, journeyContext)], lineAccessToken);
        } else if (rule?.action === "text" && rule.reply_text) {
          await replyMessages(ev.replyToken, [{ type: "text", text: rule.reply_text }], lineAccessToken);
        } else {
          await replyMessages(ev.replyToken, [lineHomeMessage(journeyContext)], lineAccessToken);
        }
        })();
      } else if (ev.type === "postback" && ev.postback?.data) {
        const params = new URLSearchParams(ev.postback.data);
        const action = params.get("action");
        if (action === "home") {
          await replyLineHome(ev.replyToken, journeyContext);
        } else if (action === "my") {
          await replyMyAppointments(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken, journeyContext);
        } else if (action === "progress" && menuCfg.progress) {
          await replyProgress(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken);
        } else if (action === "progress") {
          await safeReply(ev.replyToken, "此品牌目前未開放服務進度查詢。", lineAccessToken);
        } else if (action === "booking") {
          await replyBookingServices(ev.replyToken, ev.source?.userId, journeyContext);
        } else if (action === "booking_service") {
          await replyBookingDatePrompt(ev.replyToken, ev.source?.userId, params.get("service_id"), journeyContext);
        } else if (action === "booking_provider" || action === "booking_calendar") {
          await replyBookingDatePrompt(
            ev.replyToken,
            ev.source?.userId,
            params.get("service_id"),
            journeyContext,
            params.get("doctor_id"),
            params.get("start"),
          );
        } else if (action === "booking_date") {
          await replyBookingContinue(
            ev.replyToken,
            ev.source?.userId,
            params.get("service_id"),
            params.get("date") ?? ev.postback.params?.date,
            journeyContext,
            params.get("doctor_id"),
          );
        } else if (action === "events") {
          await replyEvents(ev.replyToken, journeyContext);
        } else if (action === "tickets") {
          await replyTickets(ev.replyToken, ev.source?.userId, journeyContext);
        } else if (action === "membership") {
          await replyMemberships(ev.replyToken, ev.source?.userId, journeyContext);
        } else if (action === "bind_member") {
          if (!ev.source?.userId) throw new Error("無法取得 LINE 身分");
          const identity = await ensureLineCustomerIdentity(svc, {
            clinicId,
            lineUserId: ev.source.userId,
            lineAccessToken,
          });
          await syncLineAudienceMenu(svc, clinicId, ev.source.userId, "member", lineAccessToken).catch(() => false);
          await replyMessages(ev.replyToken, [lineNativeMemberLinkedMessage(journeyContext, identity.displayName)], lineAccessToken);
        } else if (action === "support") {
          await startLineSupport(ev.replyToken, ev.source?.userId, journeyContext);
        } else if (action === "support_end") {
          await endLineSupport(ev.replyToken, ev.source?.userId, journeyContext);
        } else if (action === "brand") {
          await replyBrandInfo(ev.replyToken, journeyContext);
        } else if (action === "staff_today" || action === "staff_pending" || action === "staff_checkin") {
          const command = action === "staff_pending" ? "待確認" : action === "staff_checkin" ? "報到狀況" : "今日工作";
          if (!(await handleLineStaffCommand(ev.replyToken, ev.source?.userId, command, journeyContext))) {
            await safeReply(ev.replyToken, "這個 LINE 帳號尚未綁定可用的員工身分。", lineAccessToken);
          }
        } else if (action === "unlink_account") {
          await replyMessages(ev.replyToken, [lineAccountLinkConfirmation(journeyContext)], lineAccessToken);
        } else if (action === "unlink_confirm") {
          if (!ev.source?.userId) throw new Error("無法取得 LINE 身分");
          const [{ error: patientError }, { error: registrationError }, { error: identityError }] = await Promise.all([
            svc.from("patients").update({ line_user_id: null }).eq("clinic_id", clinicId).eq("line_user_id", ev.source.userId),
            svc.from("registrations").update({ line_user_id: null }).eq("clinic_id", clinicId).eq("line_user_id", ev.source.userId),
            svc.from("line_customer_identities").update({ active: false, patient_id: null }).eq("clinic_id", clinicId).eq("line_user_id", ev.source.userId),
          ]);
          if (patientError || registrationError || identityError) {
            throw new Error(patientError?.message ?? registrationError?.message ?? identityError?.message ?? "解除綁定失敗");
          }
          await resetLineAudienceMenu(ev.source.userId, lineAccessToken).catch(() => undefined);
          await safeReply(ev.replyToken, "已解除這個品牌的會員綁定，其他品牌不受影響。", lineAccessToken);
        } else if (action === "msg") {
          try {
            const msg = await buildMessageById(svc, params.get("id") ?? "", baseUrl, clinicId, liffId, clinicSlug);
            if (msg) await replyMessages(ev.replyToken, [msg], lineAccessToken);
            else
              await safeReply(
                ev.replyToken,
                "找不到此訊息素材或內容為空(請確認素材有填圖片、標題或文字)。",
                lineAccessToken,
              );
          } catch (e) {
            await safeReply(
              ev.replyToken,
              "訊息回覆失敗:" + (e instanceof Error ? e.message.slice(0, 300) : ""),
              lineAccessToken,
            );
          }
        } else if (action === "confirm" || action === "cancel") {
          await handleStatusPostback(ev.replyToken, action, params.get("id"), ev.source?.userId, svc, clinicId, lineAccessToken);
        } else {
          await safeReply(ev.replyToken, "無法辨識的操作", lineAccessToken);
        }
      }
      await finishLineWebhookEvent(svc, clinicId, ev.webhookEventId);
    } catch (error) {
      await safeReply(ev.replyToken, "處理失敗,請稍後再試。", lineAccessToken);
      if (claimed) await finishLineWebhookEvent(svc, clinicId, ev.webhookEventId, error).catch(() => undefined);
    }
  }

  return new Response("ok", { status: 200 });
}
