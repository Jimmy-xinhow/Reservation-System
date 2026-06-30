import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { verifyLineSignature, replyMessages, type LineMessage } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  replyToken?: string;
  postback?: { data?: string };
}

/**
 * POST /api/line/webhook
 * 驗 x-line-signature → 處理 postback(confirm/cancel)回寫 status,並以 replyToken 回覆。
 */
export async function POST(req: NextRequest) {
  // 必須用「原始」body 驗簽
  const raw = await req.text();
  const signature = req.headers.get("x-line-signature");
  if (!verifyLineSignature(raw, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? [];
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const svc = createServiceClient();

  for (const ev of events) {
    if (ev.type !== "postback" || !ev.postback?.data || !ev.replyToken) continue;
    const params = new URLSearchParams(ev.postback.data);
    const action = params.get("action");
    const id = params.get("id");
    if (!id || (action !== "confirm" && action !== "cancel")) {
      await safeReply(ev.replyToken, "無法辨識的操作");
      continue;
    }

    try {
      // 只處理本診所、尚可變更(booked/confirmed)的約診
      const { data: appt } = await svc
        .from("appointments")
        .select("id, status, clinic_id")
        .eq("id", id)
        .eq("clinic_id", CLINIC_ID)
        .maybeSingle();

      if (!appt) {
        await safeReply(ev.replyToken, "查無此預約");
        continue;
      }
      if (appt.status === "cancelled" || appt.status === "done" || appt.status === "no_show") {
        await safeReply(ev.replyToken, "此預約已無法變更,請洽櫃檯。");
        continue;
      }

      const newStatus = action === "confirm" ? "confirmed" : "cancelled";
      const { error: upErr } = await svc
        .from("appointments")
        .update({ status: newStatus })
        .eq("id", id)
        .eq("clinic_id", CLINIC_ID);
      if (upErr) {
        await safeReply(ev.replyToken, "處理失敗,請稍後再試或洽櫃檯。");
        continue;
      }

      await safeReply(
        ev.replyToken,
        action === "confirm" ? "已收到您的確認,期待為您服務。" : "已為您取消此預約。",
      );
    } catch {
      await safeReply(ev.replyToken, "處理失敗,請稍後再試。");
    }
  }

  // webhook 一律回 200,避免 LINE 重送
  return new Response("ok", { status: 200 });
}

async function safeReply(replyToken: string, text: string): Promise<void> {
  const msg: LineMessage = { type: "text", text };
  try {
    await replyMessages(replyToken, [msg]);
  } catch {
    // 回覆失敗不影響 webhook 回 200
  }
}
