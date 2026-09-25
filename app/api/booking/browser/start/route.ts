import { NextRequest } from "next/server";
import { parsePublicPatientInput } from "@/lib/public-patient-input";
import { createServiceClient } from "@/lib/supabase";
import { fail, getClinicSettings, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { createBrowserBookingToken } from "@/lib/browser-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rate = await checkRateLimit(req, "booking:browser-start", 8);
  if (!rate.allowed) {
    const response = fail("請稍後再試", rate.unavailable ? 503 : 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  try {
    const body = (await req.json().catch(() => null)) as { name?: string; phone?: string; birthday?: string } | null;
    const input = parsePublicPatientInput(body);
    if (!input.ok) return fail(input.error);
    const { name, phone, birthday } = input;

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
