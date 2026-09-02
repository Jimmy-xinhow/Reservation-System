import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok, rateLimitResponse } from "@/lib/http";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { taipeiToday } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = await rateLimitResponse(req, "booking:browser-my", 12);
  if (limited) return limited;

  try {
    const body = (await req.json().catch(() => null)) as { browser_token?: string } | null;
    const identity = body?.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
    if (!identity) return fail("瀏覽器預約身分驗證已失效，請重新輸入資料", 401);

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("找不到目前品牌", 500);
    if (identity.clinicId !== clinicId) return fail("預約品牌不一致", 403);

    const todayStartIso = new Date(`${taipeiToday()}T00:00:00+08:00`).toISOString();
    const [{ data, error }, { data: waitlists, error: waitlistError }] = await Promise.all([
      svc
        .from("appointments")
        .select("id, start_at, end_at, queue_number, status, doctor_id, service_id, visit_type, deposit_status, deposit_amount, doctors(name), services(name), patients(name)")
        .eq("clinic_id", clinicId)
        .eq("patient_id", identity.patientId)
        .in("status", ["booked", "confirmed"])
        .gte("start_at", todayStartIso)
        .order("start_at"),
      svc
        .from("appointment_waitlist_entries")
        .select("id, patient_id, booking_mode, requested_date, requested_start_at, position, status, offer_expires_at, appointment_id, doctors(name), services(name), patients(name)")
        .eq("clinic_id", clinicId)
        .eq("patient_id", identity.patientId)
        .in("status", ["waiting", "offered"])
        .gte("requested_date", taipeiToday())
        .order("requested_date")
        .order("position"),
    ]);
    if (error || waitlistError) return fail(error?.message ?? waitlistError?.message ?? "載入預約失敗", 500);

    const activeWaitlists = (waitlists ?? []) as Array<Record<string, unknown>>;
    const offeredAppointmentIds = new Set(activeWaitlists.filter((row) => row.status === "offered").map((row) => String(row.appointment_id ?? "")).filter(Boolean));
    const visibleAppointments = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => !offeredAppointmentIds.has(String(row.id)));
    const safeWaitlists = activeWaitlists.map((row) => ({ ...row, appointment_id: row.status === "offered" ? null : row.appointment_id }));
    return ok({ appointments: visibleAppointments, waitlists: safeWaitlists });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "載入預約失敗", 500);
  }
}
