import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, getClinicSettings, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyBrowserBookingToken, type BrowserBookingIdentity } from "@/lib/browser-booking";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { taipeiDateString } from "@/lib/slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action?: "join" | "accept" | "cancel";
  idToken?: string;
  browser_token?: string;
  patient_id?: string;
  waitlist_id?: string;
  doctor_id?: string;
  service_id?: string;
  start_at?: string;
  template_id?: string;
  date?: string;
  visit_type?: "first" | "return";
  is_self_pay?: boolean;
  booking_answers?: Record<string, unknown>;
  email?: string;
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, "booking:waitlist", 20);
  if (!rate.allowed) {
    const response = fail("請稍後再試", 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.action) return fail("缺少候補操作");
    if (!body.idToken && !body.browser_token) return fail("缺少預約身分驗證");

    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, service);
    if (!clinicId) return fail("缺少品牌設定", 500);
    const identity = await verifiedIdentity(service, clinicId, body);
    if (identity.error) return fail(identity.error, identity.status);
    if (!identity.patientId) return fail("缺少顧客", 400);

    const { data: patient, error: patientError } = await service
      .from("patients")
      .select("id, clinic_id, line_user_id, blocked_until")
      .eq("id", identity.patientId)
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .maybeSingle();
    if (patientError) return fail(patientError.message, 500);
    if (!patient) return fail("查無顧客", 404);
    if (identity.browser && patient.id !== identity.browser.patientId) return fail("瀏覽器預約身分不符", 403);
    if (!identity.browser && (!patient.line_user_id || patient.line_user_id !== identity.lineUserId)) return fail("顧客與目前 LINE 身分不符", 403);

    if (body.action === "accept" || body.action === "cancel") {
      if (!body.waitlist_id) return fail("缺少候補編號");
      if (body.action === "cancel") {
        const { error } = await service.rpc("cancel_appointment_waitlist", {
          p_clinic_id: clinicId,
          p_waitlist_id: body.waitlist_id,
          p_patient_id: patient.id,
          p_note: "customer cancelled waitlist",
        });
        if (error) return fail(translateWaitlistError(error.message), 409);
        return ok({ cancelled: true });
      }
      const { data: appointmentId, error } = await service.rpc("accept_appointment_waitlist_offer", {
        p_clinic_id: clinicId,
        p_waitlist_id: body.waitlist_id,
        p_patient_id: patient.id,
      });
      if (error) return fail(translateWaitlistError(error.message), 409);
      if (!appointmentId) return fail("候補名額保留期限已過，請重新登記", 409);
      const { data: appointment, error: appointmentError } = await service
        .from("appointments")
        .select("id, start_at, end_at, queue_number, deposit_status, deposit_amount, doctors(name), services(name)")
        .eq("id", appointmentId)
        .eq("clinic_id", clinicId)
        .eq("patient_id", patient.id)
        .maybeSingle();
      if (appointmentError) return fail(appointmentError.message, 500);
      if (!appointment) return fail("候補預約建立失敗", 500);
      return ok({ appointment });
    }

    const settings = await getClinicSettings(service, clinicId);
    if (!settings) return fail("查無品牌設定", 500);
    if (!settings.public_booking_enabled) return fail("目前暫停線上預約", 403);
    if (patient.blocked_until && new Date(patient.blocked_until) > new Date()) return fail("此顧客目前暫停線上預約資格", 403);

    const visitType = body.visit_type === "first" ? "first" : "return";
    const date = settings.booking_mode === "time" && body.start_at ? taipeiDateString(body.start_at) : body.date ?? "";
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("候補日期格式不正確");
    if (settings.booking_mode === "time" && !body.start_at) return fail("缺少候補時段");
    if (settings.booking_mode === "number" && !body.template_id) return fail("缺少候補場次");
    if (!body.doctor_id && !body.service_id) return fail("請選擇服務或服務提供者");

    if (body.service_id) {
      const { data: selectedService, error: serviceError } = await service
        .from("services")
        .select("id, booking_target, booking_fields")
        .eq("id", body.service_id)
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .maybeSingle();
      if (serviceError) return fail(serviceError.message, 500);
      if (!selectedService) return fail("服務不存在或已停用", 400);
      if (selectedService.booking_target === "provider_required" && !body.doctor_id) return fail("此服務需要選擇服務提供者");
      const answerError = validateBookingAnswers(selectedService.booking_fields, body.booking_answers ?? {});
      if (answerError) return fail(answerError);
    }

    const dayStart = new Date(`${date}T00:00:00+08:00`).toISOString();
    const dayEnd = new Date(`${date}T23:59:59.999+08:00`).toISOString();
    const { data: duplicate, error: duplicateError } = await service
      .from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patient.id)
      .in("status", ["booked", "confirmed", "done"])
      .gte("start_at", dayStart)
      .lte("start_at", dayEnd)
      .limit(1);
    if (duplicateError) return fail(duplicateError.message, 500);
    if ((duplicate ?? []).length > 0) return fail("此顧客當天已有預約，無法加入候補", 409);

    const email = body.email?.trim() || null;
    if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return fail("Email 格式不正確");
    if (email) {
      let update = service.from("patients").update({ email }).eq("id", patient.id).eq("clinic_id", clinicId);
      if (identity.lineUserId) update = update.eq("line_user_id", identity.lineUserId);
      const { error: emailError } = await update;
      if (emailError) return fail(emailError.message, 500);
    }

    const { data, error } = await service.rpc("join_appointment_waitlist", {
      p_clinic_id: clinicId,
      p_patient_id: patient.id,
      p_booking_mode: settings.booking_mode,
      p_doctor_id: body.doctor_id || null,
      p_service_id: body.service_id || null,
      p_template_id: settings.booking_mode === "number" ? body.template_id || null : null,
      p_requested_date: date,
      p_requested_start_at: settings.booking_mode === "time" ? body.start_at || null : null,
      p_visit_type: visitType,
      p_is_self_pay: body.is_self_pay === true,
      p_booking_answers: body.booking_answers ?? {},
      p_source: identity.browser ? "online" : "line",
    });
    if (error) return fail(translateWaitlistError(error.message), 409);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.waitlist_id) return fail("候補登記失敗", 500);
    return ok({ waitlist_id: row.waitlist_id, position: row.waitlist_position });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "候補操作失敗", 500);
  }
}

async function verifiedIdentity(
  service: ReturnType<typeof createServiceClient>,
  clinicId: string,
  body: Body,
): Promise<{ patientId: string | null; lineUserId: string | null; browser: BrowserBookingIdentity | null; error?: string; status: number }> {
  if (body.idToken) {
    try {
      const profile = await verifyClinicLiffIdToken(service, clinicId, body.idToken);
      return { patientId: body.patient_id ?? null, lineUserId: profile.sub, browser: null, status: 200 };
    } catch (error) {
      return { patientId: null, lineUserId: null, browser: null, error: `LINE 身分驗證失敗:${error instanceof Error ? error.message : "請重新開啟預約頁"}`, status: 401 };
    }
  }
  const browser = body.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
  if (!browser) return { patientId: null, lineUserId: null, browser: null, error: "瀏覽器預約憑證已失效", status: 401 };
  if (browser.clinicId !== clinicId) return { patientId: null, lineUserId: null, browser, error: "品牌身分不符", status: 403 };
  return { patientId: browser.patientId, lineUserId: null, browser, status: 200 };
}

function validateBookingAnswers(rawFields: unknown, answers: Record<string, unknown>): string | null {
  if (!Array.isArray(rawFields)) return null;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return "預約資料格式錯誤";
  for (const raw of rawFields) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "服務欄位設定錯誤";
    const field = raw as { key?: unknown; type?: unknown; required?: unknown; options?: unknown };
    if (typeof field.key !== "string") return "服務欄位設定錯誤";
    const value = answers[field.key];
    const empty = value === undefined || value === null || value === "" || value === false;
    if (field.required === true && empty) return `請完成必要欄位`;
    if (empty) continue;
    if (["text", "textarea", "date", "select"].includes(String(field.type)) && typeof value !== "string") return "預約欄位格式錯誤";
    if (field.type === "checkbox" && typeof value !== "boolean") return "預約欄位格式錯誤";
    if (field.type === "select" && Array.isArray(field.options) && !field.options.includes(value)) return "預約選項無效";
  }
  return JSON.stringify(answers).length > 20000 ? "預約資料過大" : null;
}

function translateWaitlistError(message: string): string {
  if (message.includes("slot is still available")) return "此時段目前仍有名額，請直接預約";
  if (message.includes("offer is unavailable")) return "候補名額目前無法接受";
  if (message.includes("offer expired")) return "候補名額保留期限已過";
  if (message.includes("not found")) return "找不到這筆候補資料";
  if (message.includes("too late")) return "已超過可候補時間";
  if (message.includes("too far away")) return "超過最長可預約區間";
  return "候補操作目前無法完成，請重新整理後再試";
}
