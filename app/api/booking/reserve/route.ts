import { deliveryError } from "@/lib/delivery-error";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { formatDateTime } from "@/lib/slots";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyBrowserBookingToken, type BrowserBookingIdentity } from "@/lib/browser-booking";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReserveBody {
  request_id?: string;
  idToken?: string;
  browser_token?: string;
  patient_id?: string;
  doctor_id?: string;
  service_id?: string;
  visit_type?: "first" | "return";
  is_self_pay?: boolean;
  membership_code?: string;
  booking_answers?: Record<string, unknown>;
  addon_ids?: string[];
  recurrence_count?: number;
  email?: string;
  // time 模式
  start_at?: string;
  // number 模式
  template_id?: string;
  date?: string;
}

/**
 * POST /api/booking/reserve
 * time 模式 → book_time_slot;number 模式 → book_number(回號碼)。
 */
export async function POST(req: NextRequest) {
  try {
    const rate = await checkRateLimit(req, "booking:reserve", 20);
    if (!rate.allowed) {
      const response = fail("請稍後再試", rate.unavailable ? 503 : 429);
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }
    const body = (await req.json().catch(() => null)) as ReserveBody | null;
    if (!body) return fail("請求格式錯誤");
    if (body.request_id !== undefined && (typeof body.request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id))) return fail("送出識別碼格式錯誤", 400);
    if (!body.idToken && !body.browser_token) return fail("缺少預約身分驗證");
    if (!body.patient_id && !body.browser_token) return fail("缺少顧客");

    const visitType: "first" | "return" = body.visit_type === "first" ? "first" : "return";
    const isSelfPay = body.is_self_pay === true;
    const membershipCode = body.membership_code?.trim().toUpperCase() || null;
    const addonIds = [...new Set(Array.isArray(body.addon_ids) ? body.addon_ids.map((value) => value.trim()).filter(Boolean) : [])];
    const email = body.email?.trim() || null;
    if (membershipCode && membershipCode.length > 40) return fail("套票序號格式錯誤", 400);
    if (addonIds.length > 10 || addonIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return fail("加購選項格式不正確", 400);
    if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return fail("Email 格式不正確", 400);

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    // 驗 LINE 身分，並綁定目前品牌的 LINE Login Channel。
    let lineUserId: string | null = null;
    let browserIdentity: BrowserBookingIdentity | null = null;
    if (body.idToken) {
      try {
        lineUserId = (await verifyClinicLiffIdToken(svc, clinicId, body.idToken)).sub;
      } catch {
        return fail("LINE 身分驗證失敗，請重新開啟預約頁。", 401);
      }
    } else {
      browserIdentity = body.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
      if (!browserIdentity) return fail("瀏覽器預約憑證已失效，請重新填寫資料", 401);
    }

    if (browserIdentity && browserIdentity.clinicId !== clinicId) return fail("品牌身分不符", 403);
    const patientId = browserIdentity?.patientId ?? body.patient_id;
    if (!patientId) return fail("缺少顧客", 400);

    // 確認顧客屬於本品牌且為此 LINE 身分
    const { data: patient, error: pErr } = await svc
      .from("patients")
      .select("id, clinic_id, line_user_id, blocked_until")
      .eq("id", patientId)
      .eq("active", true)
      .maybeSingle();
    if (pErr) return fail(pErr.message, 500);
    if (!patient || patient.clinic_id !== clinicId) return fail("查無顧客", 404);
    if (browserIdentity) {
      if (patient.id !== browserIdentity.patientId) return fail("瀏覽器預約身分不符", 403);
    } else if (!patient.line_user_id || patient.line_user_id !== lineUserId) {
      return fail("顧客與目前 LINE 身分不符", 403);
    }
    // 黑名單:停權期間不可預約
    if (patient.blocked_until && new Date(patient.blocked_until) > new Date()) {
      return fail(`此顧客預約資格暫停至 ${formatDateTime(patient.blocked_until)},請洽服務人員。`, 403);
    }

    const settings = await getClinicSettings(svc, clinicId);
    if (settings && !settings.public_booking_enabled) return fail("目前暫停線上預約", 403);
    if (!settings) return fail("查無品牌設定", 500);
    const recurrenceCount = Number.isInteger(body.recurrence_count) ? Number(body.recurrence_count) : 1;
    if (recurrenceCount < 1 || recurrenceCount > settings.max_recurring_occurrences) return fail("重複預約週數不正確", 400);
    if (recurrenceCount > 1 && !settings.recurring_booking_enabled) return fail("此品牌尚未開放重複預約", 400);
    if (recurrenceCount > 1 && settings.deposit_enabled) return fail("啟用訂金時，重複預約請由品牌人員協助建立", 400);

    let selectedServiceId: string | null = null;
    let bookingFormSnapshot: unknown[] = [];
    if (body.service_id) {
      const { data: service, error: serviceError } = await svc
        .from("services")
        .select("id, booking_target, booking_fields")
        .eq("id", body.service_id)
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .maybeSingle();
      if (serviceError) return fail(serviceError.message, 500);
      if (!service) return fail("服務不存在或已停用", 400);
      selectedServiceId = String(service.id);
      bookingFormSnapshot = Array.isArray(service.booking_fields) ? service.booking_fields : [];
      if (!body.doctor_id && service.booking_target === "provider_required") return fail("此服務需要選擇服務提供者", 400);
      const answersError = validateBookingAnswers(service.booking_fields, body.booking_answers ?? {});
      if (answersError) return fail(answersError, 400);
    } else if (!body.doctor_id) {
      return fail("請選擇服務或服務提供者", 400);
    }
    if (addonIds.length > 0 && !selectedServiceId) return fail("加購必須搭配服務", 400);

    if (settings.booking_mode === "time" && (!body.start_at || !Number.isFinite(Date.parse(body.start_at)))) return fail("缺少有效的預約時間", 400);
    if (settings.booking_mode === "number" && (!body.template_id || !body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))) return fail("缺少有效的服務場次", 400);
    const { data: submission, error: submissionError } = await svc.rpc("submit_booking_once", {
      p_clinic_id: clinicId, p_patient_id: patientId, p_request_id: body.request_id ?? randomUUID(),
      p_payload: { service_id: selectedServiceId, doctor_id: body.doctor_id || null, start_at: settings.booking_mode === "time" ? body.start_at : null,
        template_id: settings.booking_mode === "number" ? body.template_id : null, date: settings.booking_mode === "number" ? body.date : null,
        visit_type: visitType, is_self_pay: isSelfPay, membership_code: membershipCode, booking_answers: body.booking_answers ?? {},
        booking_form_snapshot: bookingFormSnapshot, addon_ids: addonIds, recurrence_count: recurrenceCount, email },
    });
    if (submissionError) return fail(translateDbError(submissionError.message), 409);
    const receipt = submission as { appointment_ids?: string[]; queue_number?: number | null; replayed?: boolean } | null;
    if (!receipt?.appointment_ids?.length) return fail("預約結果尚未確認，請使用相同內容重試或查看我的紀錄", 503);
    const appointmentIds = receipt.appointment_ids;
    const appointmentId = appointmentIds[0];
    const queueNumber = receipt.queue_number ?? null;

    // 回傳訂金狀態與行事曆所需資訊供成功頁顯示
    const { data: appt, error: resultError } = await svc
      .from("appointments")
      .select("deposit_status, deposit_amount, addons_amount, start_at, end_at, doctors(name), services(name)")
      .eq("id", appointmentId)
      .single();

    if (resultError || !appt) return fail("預約結果暫時無法讀取，請使用相同內容重試或查看我的紀錄", 503);

    const doctors = appt?.doctors as { name: string } | { name: string }[] | null;
    const services = appt?.services as { name: string } | { name: string }[] | null;
    const doctorName = Array.isArray(doctors) ? doctors[0]?.name : doctors?.name;
    const serviceName = Array.isArray(services) ? services[0]?.name : services?.name;

    if (!receipt.replayed) await Promise.all(appointmentIds.map((id) => notifyAppointmentStatus(
      svc,
      id,
      appt?.deposit_status === "pending" ? "pending" : "confirmed",
    ).catch((error: unknown) => console.error("Appointment confirmation notification failed", { category: deliveryError(error) }))));

    if (!receipt.replayed) await Promise.all(appointmentIds.map((id, index) => recordCrmInteraction(svc, {
      clinicId,
      patientId,
      kind: "booking",
      channel: "system",
      title: appointmentIds.length > 1 ? `建立週期預約（${index + 1}/${appointmentIds.length}）` : "建立預約",
      body: appointmentIds.length > 1 ? `已建立連續 ${appointmentIds.length} 週預約` : `預約已建立：${appt?.start_at ?? body.start_at ?? body.date ?? "未指定時間"}${doctorName ? `，${doctorName}` : ""}`,
      appointmentId: id,
    }).catch((error: unknown) => console.error("CRM booking interaction failed", { category: deliveryError(error) }))));

    return ok({
      appointment_id: appointmentId,
      queue_number: queueNumber,
      deposit_status: appt?.deposit_status ?? "none",
      deposit_amount: appt?.deposit_amount ?? 0,
      start_at: appt?.start_at ?? body.start_at ?? null,
      end_at: appt?.end_at ?? null,
      doctor_name: doctorName ?? null,
      service_name: serviceName ?? null,
      addons_amount: appt?.addons_amount ?? 0,
      series_count: appointmentIds.length,
      appointment_ids: appointmentIds,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "預約失敗", 500);
  }
}

/** RPC raise 的中文訊息直接回前端;其餘給通用訊息。 */
function translateDbError(msg: string): string {
  if (msg.includes("submission content mismatch")) return "送出識別碼已用於其他內容，請重新開啟預約頁";
  if (msg.includes("customer already has") || msg.includes("當日已有預約")) return "此顧客當天已有預約，請先查看我的紀錄";
  if (msg.includes("membership")) return "套票序號無效、已用完、已過期或不適用於此服務";
  if (msg.includes("add-on duration exceeds schedule")) return "所選加購會超過服務時段，請改選其他時間";
  if (msg.includes("add-on duration slot is full")) return "所選加購需要較長時間，此時段容量已滿";
  if (msg.includes("service resource is unavailable")) return "此時段所需場地或設備已被預約";
  if (msg.includes("invalid add-on") || msg.includes("add-on does not belong")) return "加購選項已失效，請重新選擇";
  if (msg.includes("recurring")) return "部分週次已無可用名額，請改選時間或減少週數";
  const known = [
    "時段已額滿",
    "本診已額滿",
    "已超過可預約時間",
    "此時段非服務時間",
    "查無此服務場次",
    "本診已休診",
    "此時段已休診",
    "本診已結束",
  ];
  const hit = known.find((k) => msg.includes(k));
  return hit ?? "此時段無法預約,請重新選擇";
}

function validateBookingAnswers(rawFields: unknown, answers: Record<string, unknown>): string | null {
  if (!Array.isArray(rawFields)) return null;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return "預約資料格式錯誤";
  for (const rawField of rawFields) {
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) return "服務表單設定錯誤";
    const field = rawField as { key?: unknown; label?: unknown; type?: unknown; required?: unknown; options?: unknown };
    const key = typeof field.key === "string" ? field.key.trim() : "";
    const label = typeof field.label === "string" && field.label.trim() ? field.label.trim() : key;
    const type = typeof field.type === "string" ? field.type : "text";
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || !["text", "textarea", "date", "select", "checkbox", "consent"].includes(type)) return "服務表單設定錯誤";
    const value = answers[key];
    const missing = value === undefined || value === null || value === "" || ((type === "checkbox" || type === "consent") && value !== true);
    if (field.required === true && missing) return `請填寫${label}`;
    if (missing) continue;
    if (["text", "textarea", "date", "select"].includes(type) && typeof value !== "string") return `${label}格式不正確`;
    if (type === "date" && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label}格式不正確`;
    if (type === "select") {
      const options = Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === "string") : [];
      if (!options.includes(String(value))) return `${label}選項無效`;
    }
  }
  return null;
}
