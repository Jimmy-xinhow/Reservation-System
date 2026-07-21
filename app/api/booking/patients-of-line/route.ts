import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/patients-of-line  body: { idToken }
 * 回傳此 LINE 身分已綁定的病患(用來判斷是否已綁定、預約時可選為誰看診)。
 */
export async function POST(req: NextRequest) {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const body = (await req.json().catch(() => null)) as { idToken?: string } | null;
    if (!body?.idToken) return fail("缺少 LINE 身分驗證");

    let lineUserId: string;
    try {
      lineUserId = (await verifyLiffIdToken(body.idToken)).sub;
    } catch (e) {
      return fail("LINE 身分驗證失敗:" + (e instanceof Error ? e.message : "請重新開啟預約頁"), 401);
    }

    const svc = createServiceClient();
    const { data, error } = await svc
      .from("patients")
      .select("id, name, phone, blocked_until")
      .eq("clinic_id", CLINIC_ID)
      .eq("line_user_id", lineUserId)
      .order("created_at");
    if (error) return fail(error.message, 500);

    return ok({ patients: data ?? [] });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "查詢失敗", 500);
  }
}
