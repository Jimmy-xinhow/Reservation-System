import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, getClinicSettings, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { createBrowserBookingToken } from "@/lib/browser-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, "booking:browser-start", 8);
  if (!rate.allowed) {
    const response = fail("請稍後再試", 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  try {
    const body = (await req.json().catch(() => null)) as { name?: string; phone?: string; birthday?: string } | null;
    const name = body?.name?.trim() ?? "";
    const phone = body?.phone?.trim() ?? "";
    const birthday = body?.birthday?.trim() ?? "";
    if (!name || !phone || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail("請填寫姓名、電話與出生年月日");
    if (name.length > 100 || phone.length > 40) return fail("資料長度不正確");

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);
    const settings = await getClinicSettings(svc, clinicId);
    if (settings && !settings.public_booking_enabled) return fail("目前暫停線上預約", 403);
    if (!settings) return fail("查無品牌設定", 500);
    const { data, error } = await svc.rpc("create_or_get_public_patient", {
      p_clinic_id: clinicId,
      p_name: name,
      p_phone: phone,
      p_birthday: birthday,
      p_line_user_id: null,
    });
    if (error) return fail(translateBrowserPatientError(error.message), 409);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.patient_id) return fail("建立瀏覽器預約身分失敗", 500);
    return ok({ browser_token: createBrowserBookingToken(clinicId, row.patient_id as string) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "建立瀏覽器預約身分失敗", 500);
  }
}

function translateBrowserPatientError(message: string): string {
  if (message.includes("patient limit")) return "此電話可登記人數已達上限";
  if (message.includes("phone already")) return "此電話已登記其他顧客，請洽服務人員";
  if (message.includes("public booking")) return "目前暫停線上預約";
  return "建立瀏覽器預約身分失敗，請稍後再試";
}
