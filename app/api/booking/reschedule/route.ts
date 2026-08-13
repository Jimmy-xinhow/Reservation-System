import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyBrowserBookingToken, type BrowserBookingIdentity } from "@/lib/browser-booking";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";
import { recordCrmInteraction } from "@/lib/crm-interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RescheduleBody {
  idToken?: string;
  browser_token?: string;
  appointment_id?: string;
  doctor_id?: string;
  service_id?: string;
  start_at?: string;
  template_id?: string;
  date?: string;
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, "booking:reschedule", 10);
  if (!rate.allowed) {
    const response = fail("請稍後再試", 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }

  try {
    const body = (await req.json().catch(() => null)) as RescheduleBody | null;
    if (!body?.appointment_id) return fail("缺少改期預約");
    if (!body.idToken && !body.browser_token) return fail("缺少身分驗證", 401);

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("找不到品牌", 500);

    let lineUserId: string | null = null;
    let browserIdentity: BrowserBookingIdentity | null = null;
    if (body.idToken) {
      try {
        lineUserId = (await verifyClinicLiffIdToken(svc, clinicId, body.idToken)).sub;
      } catch (error) {
        return fail(`LINE 身分驗證失敗：${error instanceof Error ? error.message : "請重新登入"}`, 401);
      }
    } else {
      browserIdentity = body.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
      if (!browserIdentity) return fail("瀏覽器驗證已失效，請重新開始", 401);
    }

    if (browserIdentity && browserIdentity.clinicId !== clinicId) return fail("品牌身分不一致", 403);

    const { data: appointment, error: appointmentError } = await svc
      .from("appointments")
      .select("id, clinic_id, patient_id, status, start_at, doctor_id, service_id, waitlist_entry_id, patients(line_user_id)")
      .eq("id", body.appointment_id)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (appointmentError) return fail(appointmentError.message, 500);
    if (!appointment) return fail("找不到預約", 404);
    const patient = appointment.patients as unknown as
      | { line_user_id: string | null }
      | { line_user_id: string | null }[]
      | null;
    const ownerLineUserId = Array.isArray(patient) ? patient[0]?.line_user_id : patient?.line_user_id;
    if (browserIdentity) {
      if (appointment.patient_id !== browserIdentity.patientId) return fail("此預約不屬於目前瀏覽器身分", 403);
    } else if (!lineUserId || ownerLineUserId !== lineUserId) {
      return fail("此預約不屬於目前 LINE 身分", 403);
    }
    if (appointment.waitlist_entry_id) {
      const { data: offer, error: offerError } = await svc.from("appointment_waitlist_entries").select("id").eq("id", appointment.waitlist_entry_id).eq("clinic_id", clinicId).eq("status", "offered").maybeSingle();
      if (offerError) return fail(offerError.message, 500);
      if (offer) return fail("請先接受候補名額，再進行改期", 409);
    }
    if (appointment.status !== "booked" && appointment.status !== "confirmed") {
      return fail("此預約目前無法改期");
    }

    const settings = await getClinicSettings(svc, clinicId);
    if (!settings || !settings.public_booking_enabled) return fail("目前未開放線上預約", 403);
    if (new Date(appointment.start_at).getTime() < Date.now() + settings.reschedule_lead_minutes * 60_000) return fail("已超過可改期的提前時間，請聯絡品牌客服", 409);
    if (settings.booking_mode === "time" && !body.start_at) return fail("缺少新時段");
    if (settings.booking_mode === "number" && (!body.template_id || !body.date)) return fail("缺少新場次與日期");

    let serviceId: string | null = body.service_id || (appointment.service_id as string | null) || null;
    if (serviceId) {
      const { data: service, error: serviceError } = await svc
        .from("services")
        .select("id")
        .eq("id", serviceId)
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .maybeSingle();
      if (serviceError) return fail(serviceError.message, 500);
      if (!service) return fail("服務不存在或已停用", 400);
      serviceId = String(service.id);
    }
    if (!body.doctor_id && !serviceId) return fail("缺少服務提供者或服務");

    const { data: newAppointmentId, error: rescheduleError } = await svc.rpc("reschedule_service_appointment", {
      p_clinic_id: clinicId,
      p_old_appointment_id: appointment.id,
      p_mode: settings.booking_mode,
      p_doctor_id: body.doctor_id || null,
      p_service_id: serviceId,
      p_start_at: body.start_at ?? null,
      p_template_id: body.template_id ?? null,
      p_date: body.date ?? null,
    });
    if (rescheduleError || typeof newAppointmentId !== "string") {
      return fail(translateRescheduleError(rescheduleError?.message ?? ""), 409);
    }

    const { data: newAppointment, error: newAppointmentError } = await svc
      .from("appointments")
      .select("id, queue_number, deposit_status, deposit_amount, start_at, end_at, doctors(name), services(name)")
      .eq("id", newAppointmentId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (newAppointmentError) return fail(newAppointmentError.message, 500);

    await notifyAppointmentStatus(svc, newAppointmentId, "rescheduled")
      .catch((error: unknown) => console.error("Public appointment reschedule notification failed", error));
    await recordCrmInteraction(svc, {
      clinicId,
      patientId: appointment.patient_id,
      kind: "booking",
      channel: browserIdentity ? "system" : "line",
      title: "顧客改期預約",
      body: "顧客完成預約改期，原預約已保留為取消狀態",
      appointmentId: newAppointmentId,
    }).catch((error: unknown) => console.error("CRM reschedule interaction failed", error));

    const doctors = newAppointment?.doctors as { name: string } | { name: string }[] | null;
    const services = newAppointment?.services as { name: string } | { name: string }[] | null;
    return ok({
      old_appointment_id: appointment.id,
      appointment_id: newAppointmentId,
      queue_number: newAppointment?.queue_number ?? null,
      deposit_status: newAppointment?.deposit_status ?? "none",
      deposit_amount: newAppointment?.deposit_amount ?? 0,
      start_at: newAppointment?.start_at ?? null,
      end_at: newAppointment?.end_at ?? null,
      doctor_name: Array.isArray(doctors) ? doctors[0]?.name ?? null : doctors?.name ?? null,
      service_name: Array.isArray(services) ? services[0]?.name ?? null : services?.name ?? null,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "改期失敗", 500);
  }
}

function translateRescheduleError(message: string): string {
  if (message.includes("appointment cannot be rescheduled")) return "此預約目前無法改期";
  if (message.includes("slot") || message.includes("session") || message.includes("capacity")) return "新時段已額滿或不可預約";
  if (message.includes("doctor")) return "新服務提供者不可預約";
  return message || "改期失敗，請稍後再試";
}
