import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
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
    let appointmentIds: string[] = [];

    if (recurrenceCount > 1) {
      if (!selectedServiceId) return fail("重複預約必須選擇服務", 400);
      if (settings.booking_mode === "time" && !body.start_at) return fail("缺少預約時間");
      if (settings.booking_mode === "number" && (!body.template_id || !body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))) return fail("缺少有效的服務場次");
      const { data, error } = await svc.rpc("book_recurring_appointments", {
        p_clinic_id: clinicId,
        p_service_id: selectedServiceId,
        p_doctor_id: body.doctor_id || null,
        p_patient_id: patientId,
        p_start_at: body.start_at || null,
        p_template_id: body.template_id || null,
        p_date: body.date || null,
        p_visit_type: visitType,
        p_is_self_pay: isSelfPay,
        p_membership_code: membershipCode,
        p_booking_answers: body.booking_answers ?? {},
        p_booking_form_snapshot: bookingFormSnapshot,
        p_addon_ids: addonIds,
        p_occurrence_count: recurrenceCount,
        p_interval_weeks: 1,
      });
      if (error) return fail(translateDbError(error.message));
      const rows = Array.isArray(data) ? data as Array<{ appointment_id: string; queue_number: number | null }> : [];
      if (rows.length !== recurrenceCount) return fail("重複預約建立不完整，請重新選擇", 500);
      appointmentIds = rows.map((row) => row.appointment_id);
      appointmentId = appointmentIds[0];
      queueNumber = rows[0]?.queue_number ?? null;
    } else if (settings.booking_mode === "time") {
      if (!body.start_at) return fail("缺少預約時間");
      const { data, error } = selectedServiceId
        ? await svc.rpc("book_time_slot_with_options", { p_clinic_id: clinicId, p_service_id: selectedServiceId, p_doctor_id: body.doctor_id || null, p_patient_id: patientId, p_start_at: body.start_at, p_visit_type: visitType, p_is_self_pay: isSelfPay, p_membership_code: membershipCode, p_booking_answers: body.booking_answers ?? {}, p_booking_form_snapshot: bookingFormSnapshot, p_addon_ids: addonIds })
        : await svc.rpc(membershipCode ? "book_time_slot_with_membership_for_service" : "book_time_slot_for_service", { p_clinic_id: clinicId, p_doctor_id: body.doctor_id, p_patient_id: patientId, p_start_at: body.start_at, p_visit_type: visitType, p_is_self_pay: isSelfPay, p_service_id: null, ...(membershipCode ? { p_membership_code: membershipCode } : {}) });
      if (error) return fail(translateDbError(error.message));
      appointmentId = data as string;
      appointmentIds = [appointmentId];
    } else {
      if (!body.template_id) return fail("缺少服務場次");
      if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return fail("date 格式須為 YYYY-MM-DD");
      const { data, error } = selectedServiceId
        ? await svc.rpc("book_number_with_options", { p_clinic_id: clinicId, p_service_id: selectedServiceId, p_doctor_id: body.doctor_id || null, p_patient_id: patientId, p_template_id: body.template_id, p_date: body.date, p_visit_type: visitType, p_is_self_pay: isSelfPay, p_membership_code: membershipCode, p_booking_answers: body.booking_answers ?? {}, p_booking_form_snapshot: bookingFormSnapshot, p_addon_ids: addonIds })
        : await svc.rpc(membershipCode ? "book_number_with_membership" : "book_number", { p_clinic_id: clinicId, p_doctor_id: body.doctor_id, p_patient_id: patientId, p_template_id: body.template_id, p_date: body.date, p_visit_type: visitType, p_is_self_pay: isSelfPay, ...(membershipCode ? { p_membership_code: membershipCode } : {}) });
      if (error) return fail(translateDbError(error.message));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return fail("預約失敗", 500);
      appointmentId = row.appointment_id as string;
      queueNumber = row.queue_number as number;
      appointmentIds = [appointmentId];
    }

    // RPC 成功後一次綁定來源與服務；失敗時取消剛建立的約診，避免留下無法回傳的活躍預約。
    const metadataPatch: { source: "online"; service_id?: string; booking_answers?: Record<string, unknown>; booking_form_snapshot?: unknown[] } = { source: "online" };
    // 套票 RPC 已在同一交易中綁定方案服務；沒有新服務值時不可用 null 覆蓋它。
    if (selectedServiceId) metadataPatch.service_id = selectedServiceId;
    if (body.booking_answers && selectedServiceId) metadataPatch.booking_answers = body.booking_answers;
    if (selectedServiceId) metadataPatch.booking_form_snapshot = bookingFormSnapshot;
    const { error: bindingError } = await svc
      .from("appointments")
      .update(metadataPatch)
      .in("id", appointmentIds)
      .eq("clinic_id", clinicId);
    if (bindingError) {
      await Promise.all(appointmentIds.map((id) => svc.rpc("cancel_appointment", { p_clinic_id: clinicId, p_appointment_id: id, p_note: "booking metadata binding failed" })));
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
        await Promise.all(appointmentIds.map((id) => svc.rpc("cancel_appointment", { p_clinic_id: clinicId, p_appointment_id: id, p_note: "booking email update failed" })));
        return fail(emailError.message, 500);
      }
    }

    // 回傳訂金狀態與行事曆所需資訊供成功頁顯示
    const { data: appt } = await svc
      .from("appointments")
      .select("deposit_status, deposit_amount, addons_amount, start_at, end_at, doctors(name), services(name)")
      .eq("id", appointmentId)
      .single();

    const doctors = appt?.doctors as { name: string } | { name: string }[] | null;
    const services = appt?.services as { name: string } | { name: string }[] | null;
    const doctorName = Array.isArray(doctors) ? doctors[0]?.name : doctors?.name;
    const serviceName = Array.isArray(services) ? services[0]?.name : services?.name;

    await Promise.all(appointmentIds.map((id) => notifyAppointmentStatus(
      svc,
      id,
      appt?.deposit_status === "pending" ? "pending" : "confirmed",
    ).catch((error: unknown) => console.error("Appointment confirmation notification failed", error))));

    await Promise.all(appointmentIds.map((id, index) => recordCrmInteraction(svc, {
      clinicId,
      patientId,
      kind: "booking",
      channel: "system",
      title: appointmentIds.length > 1 ? `建立週期預約（${index + 1}/${appointmentIds.length}）` : "建立預約",
      body: appointmentIds.length > 1 ? `已建立連續 ${appointmentIds.length} 週預約` : `預約已建立：${appt?.start_at ?? body.start_at ?? body.date ?? "未指定時間"}${doctorName ? `，${doctorName}` : ""}`,
      appointmentId: id,
    }).catch((error: unknown) => console.error("CRM booking interaction failed", error))));

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
