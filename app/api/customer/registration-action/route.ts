import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { checkRateLimit } from "@/lib/rate-limit";
import { notificationKindForStatus, notifyRegistrationStatus } from "@/lib/registration-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "customer:registration-action", 8);
  if (!rate.allowed) return fail("操作次數過多，請稍後再試", 429);
  try {
    const body = await request.json().catch(() => null) as { browser_token?: string; registration_id?: string; action?: string } | null;
    const identity = body?.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
    if (!identity) return fail("顧客身分已過期，請重新驗證", 401);
    if (!body?.registration_id || body.action !== "cancel") return fail("不支援的報名操作", 400);
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    if (identity.clinicId !== clinicId) return fail("品牌入口不相符", 403);
    const { data, error } = await service.rpc("cancel_registration_for_customer", {
      p_clinic_id: clinicId,
      p_registration_id: body.registration_id,
      p_patient_id: identity.patientId,
    });
    if (error) return fail(error.message, 409);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail("報名操作失敗", 409);
    const kind = notificationKindForStatus(String(row.registration_status));
    if (kind) await notifyRegistrationStatus(service, String(row.registration_id), kind).catch(() => undefined);
    return ok(row);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "報名操作失敗", 500);
  }
}
