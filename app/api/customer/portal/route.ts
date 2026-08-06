import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "customer:portal", 20);
  if (!rate.allowed) return fail("查詢次數過多，請稍後再試", 429);

  try {
    const body = await request.json().catch(() => null) as { browser_token?: string } | null;
    const token = body?.browser_token?.trim() ?? "";
    const identity = token ? verifyBrowserBookingToken(token) : null;
    if (!identity) return fail("顧客身分已過期，請重新驗證", 401);

    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    if (identity.clinicId !== clinicId) return fail("品牌入口不相符", 403);

    const [{ data: patient, error: patientError }, { data: appointments, error: appointmentsError }, { data: registrations, error: registrationsError }, { data: memberships, error: membershipsError }] = await Promise.all([
      service.from("patients").select("name").eq("clinic_id", clinicId).eq("id", identity.patientId).eq("active", true).maybeSingle(),
      service.from("appointments").select("id, start_at, end_at, status, visit_type, queue_number, doctors(name), services(name)").eq("clinic_id", clinicId).eq("patient_id", identity.patientId).gte("start_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()).order("start_at", { ascending: false }).limit(50),
      service.from("registrations").select("id, registration_no, status, payment_status, amount, created_at, events(title), event_sessions(name, start_at, end_at)").eq("clinic_id", clinicId).eq("patient_id", identity.patientId).order("created_at", { ascending: false }).limit(50),
      service.from("patient_memberships").select("membership_code, status, credits_total, credits_remaining, starts_at, expires_at, membership_plans(name, description, usage_scope)").eq("clinic_id", clinicId).eq("patient_id", identity.patientId).order("created_at", { ascending: false }).limit(30),
    ]);

    if (patientError || appointmentsError || registrationsError || membershipsError) {
      return fail("顧客資料載入失敗", 500);
    }
    if (!patient) return fail("找不到顧客資料，請重新驗證", 404);

    return ok({
      patient,
      appointments: appointments ?? [],
      registrations: registrations ?? [],
      memberships: memberships ?? [],
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "顧客資料載入失敗", 500);
  }
}
