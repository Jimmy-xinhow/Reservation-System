import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";
import { getPatientQueueToday, taipeiToday } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/my  body: { idToken }
 * 回傳此 LINE 身分名下、未來且未取消的約診。
 */
export async function POST(req: NextRequest) {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const body = (await req.json().catch(() => null)) as { idToken?: string } | null;
    if (!body?.idToken) return fail("缺少 LINE 身分驗證");

    let lineUserId: string;
    try {
      lineUserId = (await verifyLiffIdToken(body.idToken)).sub;
    } catch {
      return fail("LINE 身分驗證失敗,請重新開啟預約頁", 401);
    }

    const svc = createServiceClient();
    const { data: patients, error: pErr } = await svc
      .from("patients")
      .select("id")
      .eq("clinic_id", CLINIC_ID)
      .eq("line_user_id", lineUserId);
    if (pErr) return fail(pErr.message, 500);
    const ids = (patients ?? []).map((p) => p.id);
    if (ids.length === 0) return ok({ appointments: [], progress: [] });

    const settings = await getClinicSettings(svc, CLINIC_ID);
    const mode = settings?.booking_mode ?? "time";
    const progress = await getPatientQueueToday(svc, CLINIC_ID, lineUserId, mode);

    // 以「今天開始」為界(而非現在),避免號次制當天已到時段但仍候診的預約被漏掉
    const todayStartIso = new Date(`${taipeiToday()}T00:00:00+08:00`).toISOString();
    const { data, error } = await svc
      .from("appointments")
      .select("id, start_at, queue_number, status, doctors(name), patients(name)")
      .eq("clinic_id", CLINIC_ID)
      .in("patient_id", ids)
      .in("status", ["booked", "confirmed"])
      .gte("start_at", todayStartIso)
      .order("start_at");
    if (error) return fail(error.message, 500);

    return ok({ appointments: data ?? [], progress });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "查詢失敗", 500);
  }
}
