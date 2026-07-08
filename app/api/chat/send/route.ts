import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat/send
 * body: { idToken, body }
 * 病患在系統客服頁送出一句話。以驗證後的 line_user_id 存檔(sender=patient)。
 */
export async function POST(req: NextRequest) {
  try {
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
    const { error } = await svc.from("chat_messages").insert({
      clinic_id: CLINIC_ID,
      line_user_id: lineUserId,
      sender: "patient",
      body,
    });
    if (error) return fail(error.message, 500);
    return ok({ sent: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "送出失敗", 500);
  }
}
