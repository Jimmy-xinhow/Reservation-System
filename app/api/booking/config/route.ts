import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/config
 * 預約頁初始化:回傳 booking_mode、訂金/前置設定、可預約醫師清單(無 PII)。
 */
export async function GET() {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const svc = createServiceClient();

    const settings = await getClinicSettings(svc, CLINIC_ID);
    if (!settings) return fail("查無診所設定", 500);

    const { data: doctors, error } = await svc
      .from("doctors")
      .select("id, name, specialty")
      .eq("clinic_id", CLINIC_ID)
      .eq("active", true)
      .order("name");
    if (error) return fail(error.message, 500);

    return ok({
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
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "讀取設定失敗", 500);
  }
}
