import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";
import { formatDateTime, taipeiDateString } from "@/lib/slots";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyBrowserBookingToken, type BrowserBookingIdentity } from "@/lib/browser-booking";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReserveBody {
  idToken?: string;
  browser_token?: string;
  patient_id?: string;
  doctor_id?: string;
  service_id?: string;
  visit_type?: "first" | "return";
  is_self_pay?: boolean;
  membership_code?: string;
  booking_answers?: Record<string, unknown>;
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
    const rate = checkRateLimit(req, "booking:reserve", 20);
    if (!rate.allowed) {
      const response = fail("請稍後再試", 429);
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }
    const body = (await req.json().catch(() => null)) as ReserveBody | null;
    if (!body) return fail("請求格式錯誤");
    if (!body.idToken && !body.browser_token) return fail("缺少預約身分驗證");
    if (!body.patient_id && !body.browser_token) return fail("缺少顧客");

    const visitType: "first" | "return" = body.visit_type === "first" ? "first" : "return";
    const isSelfPay = body.is_self_pay === true;
    const membershipCode = body.membership_code?.trim().toUpperCase() || null;
    const email = body.email?.trim() || null;
    if (membershipCode && membershipCode.length > 40) return fail("套票序號格式錯誤", 400);
    if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return fail("Email 格式不正確", 400);

    // 驗 LINE 身分
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

    let selectedServiceId: string | null = null;
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
      if (!body.doctor_id && service.booking_target === "provider_required") return fail("此服務需要選擇服務提供者", 400);
      const answersError = validateBookingAnswers(service.booking_fields, body.booking_answers ?? {});
      if (answersError) return fail(answersError, 400);
    } else if (!body.doctor_id) {
      return fail("請選擇服務或服務提供者", 400);
    }

    // 同一顧客同一天不可重複預約
    const targetDate =
      settings.booking_mode === "time" && body.start_at
        ? taipeiDateString(body.start_at)
        : body.date ?? "";
    if (targetDate) {
      const dayStart = new Date(`${targetDate}T00:00:00+08:00`).toISOString();
      const dayEnd = new Date(`${targetDate}T23:59:59.999+08:00`).toISOString();
      const { data: dup } = await svc
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("patient_id", patientId)
        .in("status", ["booked", "confirmed", "done"])
        .gte("start_at", dayStart)
        .lte("start_at", dayEnd)
        .limit(1);
      if ((dup ?? []).length > 0) {
        return fail("此顧客當天已有預約,無法重複預約。", 409);
      }
    }

    let appointmentId: string;
    let queueNumber: number | null = null;

    if (settings.booking_mode === "time") {
      if (!body.start_at) return fail("缺少預約時間");
      const generic = !body.doctor_id && selectedServiceId;
      const { data, error } = await svc.rpc(
        generic
          ? membershipCode ? "book_service_slot_with_membership" : "book_service_slot"
          : membershipCode ? "book_time_slot_with_membership_for_service" : "book_time_slot_for_service",
        generic
          ? {
              p_clinic_id: clinicId,
              p_service_id: selectedServiceId,
              p_patient_id: patientId,
              p_start_at: body.start_at,
              p_visit_type: visitType,
              p_is_self_pay: isSelfPay,
              ...(membershipCode ? { p_membership_code: membershipCode } : {}),
              p_booking_answers: body.booking_answers ?? {},
            }
          : {
              p_clinic_id: clinicId,
              p_doctor_id: body.doctor_id,
              p_patient_id: patientId,
              p_start_at: body.start_at,
              p_visit_type: visitType,
              p_is_self_pay: isSelfPay,
              ...(!membershipCode ? { p_service_id: selectedServiceId, } : {}),
              ...(membershipCode ? { p_membership_code: membershipCode, p_service_id: body.service_id || null } : {}),
            },
      );
      if (error) return fail(translateDbError(error.message));
      appointmentId = data as string;
    } else {
      if (!body.template_id) return fail("缺少服務場次");
      if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return fail("date 格式須為 YYYY-MM-DD");
      const generic = !body.doctor_id && selectedServiceId;
      const { data, error } = await svc.rpc(
        generic
          ? membershipCode ? "book_service_session_with_membership" : "book_service_session"
          : membershipCode
            ? (selectedServiceId ? "book_number_with_membership_for_service" : "book_number_with_membership")
            : (selectedServiceId ? "book_number_for_service" : "book_number"),
        generic
          ? {
              p_clinic_id: clinicId,
              p_service_id: selectedServiceId,
              p_patient_id: patientId,
              p_template_id: body.template_id,
              p_date: body.date,
              p_visit_type: visitType,
              p_is_self_pay: isSelfPay,
              ...(membershipCode ? { p_membership_code: membershipCode } : {}),
              p_booking_answers: body.booking_answers ?? {},
            }
          : {
              p_clinic_id: clinicId,
              p_doctor_id: body.doctor_id,
              p_patient_id: patientId,
              p_template_id: body.template_id,
              p_date: body.date,
              p_visit_type: visitType,
              p_is_self_pay: isSelfPay,
              ...(!membershipCode ? { p_service_id: selectedServiceId } : {}),
              ...(membershipCode ? { p_membership_code: membershipCode, p_service_id: body.service_id || null } : {}),
            },
      );
      if (error) return fail(translateDbError(error.message));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return fail("預約失敗", 500);
      appointmentId = row.appointment_id as string;
      queueNumber = row.queue_number as number;
    }

    // RPC 成功後一次綁定來源與服務；失敗時取消剛建立的約診，避免留下無法回傳的活躍預約。
    const metadataPatch: { source: "online"; service_id?: string; booking_answers?: Record<string, unknown> } = { source: "online" };
    // 套票 RPC 已在同一交易中綁定方案服務；沒有新服務值時不可用 null 覆蓋它。
    if (selectedServiceId) metadataPatch.service_id = selectedServiceId;
    if (body.booking_answers && selectedServiceId) metadataPatch.booking_answers = body.booking_answers;
    const { error: bindingError } = await svc
      .from("appointments")
      .update(metadataPatch)
      .eq("id", appointmentId)
      .eq("clinic_id", clinicId);
    if (bindingError) {
      await svc.rpc("cancel_appointment", {
        p_clinic_id: clinicId,
        p_appointment_id: appointmentId,
        p_note: "booking metadata binding failed",
      });
      return fail(bindingError.message, 500);
    }

    // 只有在 LINE／瀏覽器身分已驗證且預約建立成功後，才更新顧客 Email。
    // 更新失敗時取消剛建立的預約，避免成功頁與 Email 資料不同步。
    if (email) {
      let emailUpdate = svc
        .from("patients")
        .update({ email })
        .eq("id", patientId)
        .eq("clinic_id", clinicId);
      if (lineUserId) emailUpdate = emailUpdate.eq("line_user_id", lineUserId);
      const { error: emailError } = await emailUpdate;
      if (emailError) {
        await svc.rpc("cancel_appointment", {
          p_clinic_id: clinicId,
          p_appointment_id: appointmentId,
          p_note: "booking email update failed",
        });
        return fail(emailError.message, 500);
      }
    }

    // 回傳訂金狀態與行事曆所需資訊供成功頁顯示
    const { data: appt } = await svc
      .from("appointments")
      .select("deposit_status, deposit_amount, start_at, end_at, doctors(name), services(name)")
      .eq("id", appointmentId)
      .single();

    const doctors = appt?.doctors as { name: string } | { name: string }[] | null;
    const services = appt?.services as { name: string } | { name: string }[] | null;
    const doctorName = Array.isArray(doctors) ? doctors[0]?.name : doctors?.name;
    const serviceName = Array.isArray(services) ? services[0]?.name : services?.name;

    await notifyAppointmentStatus(
      svc,
      appointmentId,
      appt?.deposit_status === "pending" ? "pending" : "confirmed",
    ).catch((error: unknown) => console.error("Appointment confirmation notification failed", error));

    await recordCrmInteraction(svc, {
      clinicId,
      patientId,
      kind: "booking",
      channel: "system",
      title: "建立預約",
      body: `預約已建立：${appt?.start_at ?? body.start_at ?? body.date ?? "未指定時間"}${doctorName ? `，${doctorName}` : ""}`,
      appointmentId,
    }).catch((error: unknown) => console.error("CRM booking interaction failed", error));

    return ok({
      appointment_id: appointmentId,
      queue_number: queueNumber,
      deposit_status: appt?.deposit_status ?? "none",
      deposit_amount: appt?.deposit_amount ?? 0,
      start_at: appt?.start_at ?? body.start_at ?? null,
      end_at: appt?.end_at ?? null,
      doctor_name: doctorName ?? null,
      service_name: serviceName ?? null,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "預約失敗", 500);
  }
}

/** RPC raise 的中文訊息直接回前端;其餘給通用訊息。 */
function translateDbError(msg: string): string {
  if (msg.includes("membership")) return "套票序號無效、已用完、已過期或不適用於此服務";
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
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || !["text", "textarea", "date", "select", "checkbox"].includes(type)) return "服務表單設定錯誤";
    const value = answers[key];
    const missing = value === undefined || value === null || value === "" || (type === "checkbox" && value !== true);
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
