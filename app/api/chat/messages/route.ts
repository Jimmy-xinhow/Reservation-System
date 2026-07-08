import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";

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
 * 病患輪詢自己的客服對話(最近 200 則)。順帶把櫃檯訊息標記為病患已讀。
 */
export async function POST(req: NextRequest) {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const payload = (await req.json().catch(() => null)) as { idToken?: string } | null;
    if (!payload?.idToken) return fail("缺少 LINE 身分驗證");

    let lineUserId: string;
    try {
      const profile = await verifyLiffIdToken(payload.idToken);
      lineUserId = profile.sub;
    } catch (e) {
      return fail("LINE 身分驗證失敗:" + (e instanceof Error ? e.message : "請重新開啟頁面"), 401);
    }

    const svc = createServiceClient();
    const { data, error } = await svc
      .from("chat_messages")
      .select("id, sender, body, created_at")
      .eq("clinic_id", CLINIC_ID)
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return fail(error.message, 500);

    // 標記櫃檯訊息為病患已讀(不影響回傳)
    await svc
      .from("chat_messages")
      .update({ read_by_patient: true })
      .eq("clinic_id", CLINIC_ID)
      .eq("line_user_id", lineUserId)
      .eq("sender", "staff")
      .eq("read_by_patient", false);

    return ok({ messages: (data ?? []) as ChatMsg[] });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "載入失敗", 500);
  }
}
