import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings, rateLimitResponse } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { getPatientQueueToday, taipeiToday } from "@/lib/queue";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { isLegacyProgressEnabled } from "@/lib/legacy-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/my  body: { idToken }
 * 回傳此 LINE 身分名下、未來且未取消的約診。
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimitResponse(req, "booking:my", 12);
  if (limited) return limited;
  try {
    const body = (await req.json().catch(() => null)) as { idToken?: string } | null;
    if (!body?.idToken) return fail("缺少 LINE 身分驗證");

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    let lineUserId: string;
    try {
      lineUserId = (await verifyClinicLiffIdToken(svc, clinicId, body.idToken)).sub;
    } catch {
      return fail("LINE 身分驗證失敗，請重新開啟預約頁。", 401);
    }

    const { data: patients, error: pErr } = await svc
      .from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("line_user_id", lineUserId);
    if (pErr) return fail(pErr.message, 500);
    const ids = (patients ?? []).map((p) => p.id);
    if (ids.length === 0) return ok({ appointments: [], waitlists: [], progress: [] });

    const settings = await getClinicSettings(svc, clinicId);
    const mode = settings?.booking_mode ?? "time";
    const progress = (await isLegacyProgressEnabled(svc, clinicId))
      ? await getPatientQueueToday(svc, clinicId, lineUserId, mode)
      : [];

    // 以「今天開始」為界(而非現在),避免號次制當天已到時段但仍候診的預約被漏掉
    const todayStartIso = new Date(`${taipeiToday()}T00:00:00+08:00`).toISOString();
    const [{ data, error }, { data: waitlists, error: waitlistError }] = await Promise.all([
      svc
        .from("appointments")
        .select("id, start_at, end_at, queue_number, status, doctor_id, service_id, visit_type, deposit_status, deposit_amount, doctors(name), services(name), patients(name)")
        .eq("clinic_id", clinicId)
        .in("patient_id", ids)
        .in("status", ["booked", "confirmed"])
        .gte("start_at", todayStartIso)
        .order("start_at"),
      svc
        .from("appointment_waitlist_entries")
        .select("id, patient_id, booking_mode, requested_date, requested_start_at, position, status, offer_expires_at, appointment_id, doctors(name), services(name), patients(name)")
        .eq("clinic_id", clinicId)
        .in("patient_id", ids)
        .in("status", ["waiting", "offered"])
        .gte("requested_date", taipeiToday())
        .order("requested_date")
        .order("position"),
    ]);
    if (error || waitlistError) return fail(error?.message ?? waitlistError?.message ?? "查詢失敗", 500);

    const activeWaitlists = (waitlists ?? []) as Array<Record<string, unknown>>;
    const offeredAppointmentIds = new Set(activeWaitlists.filter((row) => row.status === "offered").map((row) => String(row.appointment_id ?? "")).filter(Boolean));
    const visibleAppointments = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => !offeredAppointmentIds.has(String(row.id)));
    const safeWaitlists = activeWaitlists.map((row) => ({ ...row, appointment_id: row.status === "offered" ? null : row.appointment_id }));
    return ok({ appointments: visibleAppointments, waitlists: safeWaitlists, progress });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "查詢失敗", 500);
  }
}
