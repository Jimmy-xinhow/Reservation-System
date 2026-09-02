import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, rateLimitResponse } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/patients-of-line  body: { idToken }
 * 回傳此 LINE 身分已綁定的病患(用來判斷是否已綁定、預約時可選為誰看診)。
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimitResponse(req, "booking:patients-of-line", 12);
  if (limited) return limited;
  try {
    const body = (await req.json().catch(() => null)) as { idToken?: string } | null;
    if (!body?.idToken) return fail("缺少 LINE 身分驗證");

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    let lineUserId: string;
    try {
      lineUserId = (await verifyClinicLiffIdToken(svc, clinicId, body.idToken)).sub;
    } catch {
      return fail("LINE 身分驗證失敗，請重新開啟預約頁。", 401);
    }

    const { data, error } = await svc
      .from("patients")
      .select("id, name, phone, email, blocked_until")
      .eq("clinic_id", clinicId)
      .eq("line_user_id", lineUserId)
      .eq("active", true)
      .order("created_at");
    if (error) return fail(error.message, 500);

    return ok({ patients: data ?? [] });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "查詢失敗", 500);
  }
}
