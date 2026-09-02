import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { verifyLineSignature, replyMessages, lineAccessTokenForDestination, lineSecretForDestination } from "@/lib/line";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { bookingPrompt, buildMessageById, menuMessage, replyMyAppointments, replyProgress, welcomeMessage, type MenuConfig } from "@/lib/line-webhook-messages";
import { safeReply } from "@/lib/line-webhook-reply";
import { handleStatusPostback } from "@/lib/line-webhook-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string };
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
  if (!verifyLineSignature(raw, signature, lineSecretForDestination(destination))) {
    return new Response("invalid signature", { status: 401 });
  }
  const events = payload.events ?? [];

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${proto}://${host}` : "";

  const svc = createServiceClient();
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
  const lineAccessToken = lineAccessTokenForDestination(destination);

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
        "line_welcome_text, line_fallback_text, line_menu_title, line_menu_btn_booking, line_menu_btn_query, line_menu_btn_progress, line_menu_btn_info, line_menu_link_label, line_menu_link_url, legacy_progress_enabled",
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

  for (const ev of events) {
    if (!ev.replyToken) continue;
    try {
      if (ev.type === "follow") {
         await replyMessages(ev.replyToken, [welcomeMessage(baseUrl, welcomeText, menuCfg, liffId, clinicSlug, clinicName)], lineAccessToken);
      } else if (ev.type === "message" && ev.message?.type === "text") {
        const text = (ev.message.text ?? "").trim();
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
          await replyMyAppointments(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken);
        } else if (rule?.action === "booking") {
          await replyMessages(ev.replyToken, [bookingPrompt(baseUrl, liffId, clinicSlug, clinicName)], lineAccessToken);
        } else if (rule?.action === "message" && rule.message_id) {
          const msg = await buildMessageById(svc, rule.message_id, baseUrl, clinicId, liffId, clinicSlug);
          if (msg) await replyMessages(ev.replyToken, [msg], lineAccessToken);
          else await replyMessages(ev.replyToken, [menuMessage(baseUrl, fallbackText, menuCfg, liffId, clinicSlug, clinicName)], lineAccessToken);
        } else if (rule?.action === "text" && rule.reply_text) {
          await replyMessages(ev.replyToken, [{ type: "text", text: rule.reply_text }], lineAccessToken);
        } else {
          await replyMessages(ev.replyToken, [menuMessage(baseUrl, fallbackText, menuCfg, liffId, clinicSlug, clinicName)], lineAccessToken);
        }
      } else if (ev.type === "postback" && ev.postback?.data) {
        const params = new URLSearchParams(ev.postback.data);
        const action = params.get("action");
        if (action === "my") {
          await replyMyAppointments(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken);
        } else if (action === "progress" && menuCfg.progress) {
          await replyProgress(ev.replyToken, ev.source?.userId, svc, clinicId, lineAccessToken);
        } else if (action === "progress") {
          await safeReply(ev.replyToken, "此品牌目前未開放服務進度查詢。", lineAccessToken);
        } else if (action === "booking") {
          await replyMessages(ev.replyToken, [bookingPrompt(baseUrl, liffId, clinicSlug, clinicName)], lineAccessToken);
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
    } catch {
      await safeReply(ev.replyToken, "處理失敗,請稍後再試。", lineAccessToken);
    }
  }

  return new Response("ok", { status: 200 });
}
