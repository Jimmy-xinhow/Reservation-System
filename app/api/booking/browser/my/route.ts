import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok, rateLimitResponse } from "@/lib/http";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { taipeiToday } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = rateLimitResponse(req, "booking:browser-my", 12);
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
    const { data, error } = await svc
      .from("appointments")
      .select("id, start_at, end_at, queue_number, status, doctor_id, service_id, visit_type, doctors(name), patients(name)")
      .eq("clinic_id", clinicId)
      .eq("patient_id", identity.patientId)
      .in("status", ["booked", "confirmed"])
      .gte("start_at", todayStartIso)
      .order("start_at");
    if (error) return fail(error.message, 500);

    return ok({ appointments: data ?? [] });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "載入預約失敗", 500);
  }
}
