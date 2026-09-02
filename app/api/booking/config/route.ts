import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { getClinicLineChannelContext } from "@/lib/line-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/config
 * 預約頁初始化:回傳 booking_mode、訂金/前置設定、可預約醫師清單(無 PII)。
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimitResponse(req, "booking:config", 20);
  if (limited) return limited;
  try {
    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    const settings = await getClinicSettings(svc, clinicId);
    if (settings && !settings.public_booking_enabled) return fail("目前暫停線上預約", 403);
    if (!settings) return fail("查無品牌設定", 500);

    const [{ data: clinic, error: clinicError }, { data: doctors, error }, lineContext] = await Promise.all([
      svc.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
      svc
        .from("doctors")
        .select("id, name, specialty")
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .order("name"),
      getClinicLineChannelContext(svc, clinicId),
    ]);
    if (clinicError || error) return fail(clinicError?.message ?? error?.message ?? "無法載入公開品牌", 500);

    const { data: services, error: servicesError } = await svc
      .from("services")
      .select("id, name, description, booking_target, booking_fields, service_addons(id, name, description, duration_minutes, price, active)")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("created_at");
    if (servicesError) return fail(servicesError.message, 500);

    return ok({
      clinic_name: clinic?.name ?? null,
      liff_id: lineContext.enabled ? lineContext.liffId : null,
      booking_mode: settings.booking_mode,
      first_visit_extends: settings.first_visit_extends,
      deposit_enabled: settings.deposit_enabled,
      deposit_amount: settings.deposit_amount,
      deposit_scope: settings.deposit_scope,
      min_lead_minutes: settings.min_lead_minutes,
      max_advance_days: settings.max_advance_days,
      recurring_booking_enabled: settings.recurring_booking_enabled && !settings.deposit_enabled,
      max_recurring_occurrences: settings.max_recurring_occurrences,
      allow_multi_patient_per_phone: settings.allow_multi_patient_per_phone,
      max_patients_per_phone: settings.max_patients_per_phone,
      doctors: doctors ?? [],
      services: (services ?? []).map((service) => ({
        ...service,
        service_addons: Array.isArray(service.service_addons)
          ? service.service_addons.filter((addon) => addon.active).map((addon) => ({
              id: addon.id,
              name: addon.name,
              description: addon.description,
              duration_minutes: addon.duration_minutes,
              price: addon.price,
            }))
          : [],
      })),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "讀取設定失敗", 500);
  }
}
