import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, getClinicSettings, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { createBrowserBookingToken, verifyBrowserBookingToken } from "@/lib/browser-booking";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { decryptRegistrationToken } from "@/lib/registration-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "customer:portal", 20);
  if (!rate.allowed) return fail("查詢次數過多，請稍後再試", 429);

  try {
    const body = await request.json().catch(() => null) as { browser_token?: string; idToken?: string; patient_id?: string } | null;
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const browserIdentity = body?.browser_token?.trim() ? verifyBrowserBookingToken(body.browser_token.trim()) : null;
    let patientId: string | null = null;
    let patients: Array<{ id: string; name: string }> = [];
    let browserToken = body?.browser_token?.trim() ?? "";

    if (browserIdentity) {
      if (browserIdentity.clinicId !== clinicId) return fail("品牌入口不相符", 403);
      const { data: patient, error: patientError } = await service
        .from("patients")
        .select("id, name")
        .eq("clinic_id", clinicId)
        .eq("id", browserIdentity.patientId)
        .eq("active", true)
        .maybeSingle();
      if (patientError) return fail("顧客資料載入失敗", 500);
      if (!patient) return fail("找不到顧客資料，請重新驗證", 404);
      patients = [patient];
      patientId = patient.id;
    } else if (body?.idToken?.trim()) {
      let lineUserId: string;
      try {
        lineUserId = (await verifyClinicLiffIdToken(service, clinicId, body.idToken.trim())).sub;
      } catch {
        return fail("LINE 身分驗證失敗，請重新開啟頁面。", 401);
      }
      const { data: linkedPatients, error: linkedPatientError } = await service
        .from("patients")
        .select("id, name")
        .eq("clinic_id", clinicId)
        .eq("line_user_id", lineUserId)
        .eq("active", true)
        .order("created_at");
      if (linkedPatientError) return fail("顧客資料載入失敗", 500);
      patients = linkedPatients ?? [];
      const requestedPatientId = body.patient_id?.trim() ?? "";
      const selectedPatient = requestedPatientId
        ? patients.find((patient) => patient.id === requestedPatientId)
        : patients[0];
      if (requestedPatientId && !selectedPatient) return fail("顧客不屬於目前 LINE 身分", 403);
      if (!selectedPatient) return ok({ patient: null, patients: [], browser_token: null, appointments: [], registrations: [], memberships: [] });
      patientId = selectedPatient.id;
      browserToken = createBrowserBookingToken(clinicId, patientId);
    } else {
      return fail("顧客身分已過期，請重新驗證", 401);
    }

    const patient = patients.find((item) => item.id === patientId) ?? null;
    if (!patientId || !patient) return fail("找不到顧客資料，請重新驗證", 404);
    const settings = await getClinicSettings(service, clinicId);
    if (!settings) return fail("品牌設定不存在", 503);

    const [{ data: appointments, error: appointmentsError }, { data: registrations, error: registrationsError }, { data: memberships, error: membershipsError }] = await Promise.all([
      service.from("appointments").select("id, start_at, end_at, status, visit_type, queue_number, doctors(name), services(name)").eq("clinic_id", clinicId).eq("patient_id", patientId).gte("start_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()).order("start_at", { ascending: false }).limit(50),
      settings.events_enabled === true
        ? service.from("registrations").select("id, registration_no, status, payment_status, amount, created_at, checkin_token_encrypted, events(title), event_sessions(name, start_at, end_at)").eq("clinic_id", clinicId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [], error: null }),
      settings.memberships_enabled === true
        ? service.from("patient_memberships").select("membership_code, status, credits_total, credits_remaining, starts_at, expires_at, membership_plans(name, description, usage_scope)").eq("clinic_id", clinicId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(30)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (appointmentsError || registrationsError || membershipsError) {
      return fail("顧客資料載入失敗", 500);
    }
    const safeRegistrations = (registrations ?? []).map(({ checkin_token_encrypted: encrypted, ...registration }) => ({
      ...registration,
      checkin_token: ["confirmed", "attended"].includes(String(registration.status)) && registration.payment_status !== "pending"
        ? decryptRegistrationToken(encrypted)
        : null,
    }));

    return ok({
      patient,
      patients,
      browser_token: browserToken,
      availability: {
        appointments: true,
        tickets: settings.events_enabled === true,
        memberships: settings.memberships_enabled === true,
      },
      appointments: appointments ?? [],
      registrations: safeRegistrations,
      memberships: memberships ?? [],
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "顧客資料載入失敗", 500);
  }
}
