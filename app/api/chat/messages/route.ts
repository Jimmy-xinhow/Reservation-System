import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, rateLimitResponse } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ChatMsg {
  id: string;
  sender: "patient" | "staff";
  body: string;
  created_at: string;
}

/**
 * POST /api/chat/messages
 * body: { idToken }
 * 顧客輪詢自己的客服對話(最近 200 則)。順帶把服務人員訊息標記為顧客已讀。
 */
export async function POST(req: NextRequest) {
  const limited = rateLimitResponse(req, "chat:messages", 20);
  if (limited) return limited;
  try {
    const payload = (await req.json().catch(() => null)) as { idToken?: string } | null;
    if (!payload?.idToken) return fail("缺少 LINE 身分驗證");

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    let lineUserId: string;
    try {
      const profile = await verifyClinicLiffIdToken(svc, clinicId, payload.idToken);
      lineUserId = profile.sub;
    } catch (e) {
      return fail("LINE 身分驗證失敗:" + (e instanceof Error ? e.message : "請重新開啟頁面"), 401);
    }

    const { data, error } = await svc
      .from("chat_messages")
      .select("id, sender, body, created_at")
      .eq("clinic_id", clinicId)
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return fail(error.message, 500);

    // 標記服務人員訊息為顧客已讀(不影響回傳)
    await svc
      .from("chat_messages")
      .update({ read_by_patient: true })
      .eq("clinic_id", clinicId)
      .eq("line_user_id", lineUserId)
      .eq("sender", "staff")
      .eq("read_by_patient", false);

    return ok({ messages: (data ?? []) as ChatMsg[] });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "載入失敗", 500);
  }
}
