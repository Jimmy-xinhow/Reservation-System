import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/availability?doctor_id=...&service_id=...&date=YYYY-MM-DD
 * 依 clinic_settings.booking_mode 回傳可預約時段(time)或可預約場次(number)。
 */
export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, "booking:availability", 30);
  if (limited) return limited;
  try {
    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);
    const sp = req.nextUrl.searchParams;
    const doctorId = sp.get("doctor_id")?.trim() || null;
    const serviceId = sp.get("service_id")?.trim() || null;
    const date = sp.get("date");
    const visitType = sp.get("visit_type") === "first" ? "first" : "return";
    if (!doctorId && !serviceId) return fail("請選擇服務或服務提供者");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("date 格式須為 YYYY-MM-DD");

    const settings = await getClinicSettings(svc, clinicId);
    if (settings && !settings.public_booking_enabled) return fail("目前暫停線上預約", 403);
    if (!settings) return fail("查無品牌設定", 500);

    if (doctorId) {
      const { data: doctor, error: doctorError } = await svc
        .from("doctors")
        .select("id")
        .eq("id", doctorId)
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .maybeSingle();
      if (doctorError) return fail(doctorError.message, 500);
      if (!doctor) return fail("服務提供者不存在或已停用", 404);
    }

    if (serviceId) {
      const { data: service, error: serviceError } = await svc.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
      if (serviceError) return fail(serviceError.message, 500);
      if (!service) return fail("服務項目不存在或已停用", 400);
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
    const maxDateValue = new Date(`${today}T00:00:00+08:00`);
    maxDateValue.setUTCDate(maxDateValue.getUTCDate() + settings.max_advance_days);
    const maxDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(maxDateValue);
    if (date < today || date > maxDate) return fail("預約日期超出可預約範圍", 400);

    if (settings.booking_mode === "time") {
      const rpcName = !doctorId ? "get_available_service_slots" : serviceId ? "get_available_slots_for_service" : "get_available_slots";
      const { data, error } = await svc.rpc(rpcName, !doctorId
        ? { p_clinic_id: clinicId, p_service_id: serviceId, p_date: date, p_visit_type: visitType }
        : {
            p_clinic_id: clinicId,
            p_doctor_id: doctorId,
            p_date: date,
            p_visit_type: visitType,
            ...(serviceId ? { p_service_id: serviceId } : {}),
          });
      if (error) return fail(error.message, 500);
      return ok({ mode: "time", slots: data ?? [] });
    } else {
      const rpcName = !doctorId ? "get_available_service_sessions" : serviceId ? "get_available_sessions_for_service" : "get_available_sessions";
      const { data, error } = await svc.rpc(rpcName, !doctorId
        ? { p_clinic_id: clinicId, p_service_id: serviceId, p_date: date }
        : {
            p_clinic_id: clinicId,
            p_doctor_id: doctorId,
            p_date: date,
            ...(serviceId ? { p_service_id: serviceId } : {}),
          });
      if (error) return fail(error.message, 500);
      return ok({ mode: "number", sessions: data ?? [] });
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "查詢空檔失敗", 500);
  }
}
