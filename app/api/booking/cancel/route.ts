import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyBrowserBookingToken, type BrowserBookingIdentity } from "@/lib/browser-booking";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/cancel  body: { idToken, appointment_id }
 * 病患自助取消:驗 LINE 身分 + 確認該約診屬於此身分,改 status='cancelled'(不刪)。
 */
export async function POST(req: NextRequest) {
  try {
    const rate = checkRateLimit(req, "booking:cancel", 10);
    if (!rate.allowed) {
      const response = fail("請稍後再試", 429);
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }
    const body = (await req.json().catch(() => null)) as {
      idToken?: string;
      browser_token?: string;
      appointment_id?: string;
    } | null;
    if (!body?.idToken && !body?.browser_token) return fail("缺少預約身分驗證");
    if (!body.appointment_id) return fail("缺少預約編號");

    let lineUserId: string | null = null;
    let browserIdentity: BrowserBookingIdentity | null = null;
    if (body.idToken) {
      try {
        lineUserId = (await verifyLiffIdToken(body.idToken)).sub;
      } catch (e) {
        return fail("LINE 身分驗證失敗:" + (e instanceof Error ? e.message : "請重新開啟預約頁"), 401);
      }
    } else {
      browserIdentity = body.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
      if (!browserIdentity) return fail("瀏覽器預約憑證已失效，請重新填寫資料", 401);
    }

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);
    if (browserIdentity && browserIdentity.clinicId !== clinicId) return fail("品牌身分不符", 403);
    // 取約診 + 其病患的 line_user_id,確認擁有權
    const { data: appt, error } = await svc
      .from("appointments")
      .select("id, status, clinic_id, patient_id, membership_id, patients(line_user_id)")
      .eq("id", body.appointment_id)
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!appt || appt.clinic_id !== clinicId) return fail("查無此預約", 404);

    const pf = appt.patients as unknown as
      | { line_user_id: string | null }
      | { line_user_id: string | null }[]
      | null;
    const owner = Array.isArray(pf) ? pf[0]?.line_user_id : pf?.line_user_id;
    if (browserIdentity) {
      if (appt.patient_id !== browserIdentity.patientId) return fail("此預約不屬於目前瀏覽器身分", 403);
    } else if (!owner || owner !== lineUserId) return fail("此預約不屬於目前 LINE 身分", 403);

    if (appt.status !== "booked" && appt.status !== "confirmed") {
      return fail("此預約已無法取消,請洽櫃檯。");
    }

    const { error: cancelError } = await svc.rpc("cancel_appointment", {
      p_clinic_id: clinicId,
      p_appointment_id: appt.id,
      p_note: "cancelled appointment",
    });
    if (cancelError) return fail(cancelError.message, 500);
    await notifyAppointmentStatus(svc, appt.id, "cancelled").catch((notificationError: unknown) => console.error("Appointment cancellation notification failed", notificationError));
    await recordCrmInteraction(svc, {
      clinicId,
      patientId: appt.patient_id,
      kind: "booking",
      channel: browserIdentity ? "system" : "line",
      title: "取消預約",
      body: "顧客取消預約",
      appointmentId: appt.id,
    }).catch((interactionError: unknown) => console.error("CRM cancellation interaction failed", interactionError));

    return ok({ cancelled: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "取消失敗", 500);
  }
}
