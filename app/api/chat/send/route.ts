import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";
import { isClinicOpenNow } from "@/lib/queue";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 非看診時間的自動回覆
const OFFHOURS_REPLY = "現在非看診時間,我們將在看診時間時盡快回復您";

/**
 * POST /api/chat/send
 * body: { idToken, body }
 * 病患在系統客服頁送出一句話。以驗證後的 line_user_id 存檔(sender=patient)。
 */
export async function POST(req: NextRequest) {
  try {
    const rate = checkRateLimit(req, "chat:send", 20);
    if (!rate.allowed) {
      const response = fail("請稍後再試", 429);
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const payload = (await req.json().catch(() => null)) as {
      idToken?: string;
      body?: string;
    } | null;
    if (!payload) return fail("請求格式錯誤");

    const body = (payload.body ?? "").trim();
    if (!body) return fail("請輸入訊息");
    if (body.length > 2000) return fail("訊息過長");
    if (!payload.idToken) return fail("缺少 LINE 身分驗證");

    let lineUserId: string;
    try {
      const profile = await verifyLiffIdToken(payload.idToken);
      lineUserId = profile.sub;
    } catch (e) {
      return fail("LINE 身分驗證失敗:" + (e instanceof Error ? e.message : "請重新開啟頁面"), 401);
    }

    const svc = createServiceClient();

    // 黑名單:被封鎖者訊息一律靜默丟棄(不存、不回,對方無從得知被封,避免激怒)
    const { data: blk } = await svc
      .from("chat_blocks")
      .select("line_user_id")
      .eq("clinic_id", CLINIC_ID)
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (blk) return ok({ sent: true });

    // 非看診時間:先看最後一則,避免連續訊息重複貼同一句自動回覆
    const open = await isClinicOpenNow(svc, CLINIC_ID);
    let lastBody: string | null = null;
    if (!open) {
      const { data: last } = await svc
        .from("chat_messages")
        .select("body")
        .eq("clinic_id", CLINIC_ID)
        .eq("line_user_id", lineUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lastBody = (last?.body as string) ?? null;
    }

    const { error } = await svc.from("chat_messages").insert({
      clinic_id: CLINIC_ID,
      line_user_id: lineUserId,
      sender: "patient",
      body,
    });
    if (error) return fail(error.message, 500);

    // 非看診時間且上一則不是同一句自動回覆 → 自動回覆一次(以 staff 身分,病患看得到)
    if (!open && lastBody !== OFFHOURS_REPLY) {
      await svc.from("chat_messages").insert({
        clinic_id: CLINIC_ID,
        line_user_id: lineUserId,
        sender: "staff",
        body: OFFHOURS_REPLY,
        read_by_staff: true, // 自動回覆不算櫃檯未讀
      });
    }
    return ok({ sent: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "送出失敗", 500);
  }
}
