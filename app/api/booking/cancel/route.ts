import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/cancel  body: { idToken, appointment_id }
 * 病患自助取消:驗 LINE 身分 + 確認該約診屬於此身分,改 status='cancelled'(不刪)。
 */
export async function POST(req: NextRequest) {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const body = (await req.json().catch(() => null)) as {
      idToken?: string;
      appointment_id?: string;
    } | null;
    if (!body?.idToken) return fail("缺少 LINE 身分驗證");
    if (!body.appointment_id) return fail("缺少預約編號");

    let lineUserId: string;
    try {
      lineUserId = (await verifyLiffIdToken(body.idToken)).sub;
    } catch {
      return fail("LINE 身分驗證失敗,請重新開啟預約頁", 401);
    }

    const svc = createServiceClient();
    // 取約診 + 其病患的 line_user_id,確認擁有權
    const { data: appt, error } = await svc
      .from("appointments")
      .select("id, status, clinic_id, patients(line_user_id)")
      .eq("id", body.appointment_id)
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!appt || appt.clinic_id !== CLINIC_ID) return fail("查無此預約", 404);

    const pf = appt.patients as unknown as
      | { line_user_id: string | null }
      | { line_user_id: string | null }[]
      | null;
    const owner = Array.isArray(pf) ? pf[0]?.line_user_id : pf?.line_user_id;
    if (!owner || owner !== lineUserId) return fail("此預約不屬於目前 LINE 身分", 403);

    if (appt.status !== "booked" && appt.status !== "confirmed") {
      return fail("此預約已無法取消,請洽櫃檯。");
    }

    const { error: upErr } = await svc
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", body.appointment_id)
      .eq("clinic_id", CLINIC_ID);
    if (upErr) return fail(upErr.message, 500);

    return ok({ cancelled: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "取消失敗", 500);
  }
}
