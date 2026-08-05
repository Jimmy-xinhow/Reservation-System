import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/config
 * 預約頁初始化:回傳 booking_mode、訂金/前置設定、可預約醫師清單(無 PII)。
 */
export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, "booking:config", 20);
  if (limited) return limited;
  try {
    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    const settings = await getClinicSettings(svc, clinicId);
    if (settings && !settings.public_booking_enabled) return fail("目前暫停線上預約", 403);
    if (!settings) return fail("查無診所設定", 500);

    const [{ data: clinic, error: clinicError }, { data: doctors, error }] = await Promise.all([
      svc.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
      svc
        .from("doctors")
        .select("id, name, specialty")
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .order("name"),
    ]);
    if (clinicError || error) return fail(clinicError?.message ?? error?.message ?? "無法載入公開品牌", 500);

    const { data: services } = await svc
      .from("services")
      .select("id, name, description")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("created_at");

    return ok({
      clinic_name: clinic?.name ?? null,
      booking_mode: settings.booking_mode,
      first_visit_extends: settings.first_visit_extends,
      deposit_enabled: settings.deposit_enabled,
      deposit_amount: settings.deposit_amount,
      deposit_scope: settings.deposit_scope,
      min_lead_minutes: settings.min_lead_minutes,
      max_advance_days: settings.max_advance_days,
      allow_multi_patient_per_phone: settings.allow_multi_patient_per_phone,
      max_patients_per_phone: settings.max_patients_per_phone,
      doctors: doctors ?? [],
      services: services ?? [],
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "讀取設定失敗", 500);
  }
}
