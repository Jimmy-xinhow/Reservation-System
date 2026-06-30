import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReserveBody {
  idToken?: string;
  patient_id?: string;
  doctor_id?: string;
  visit_type?: "first" | "return";
  is_self_pay?: boolean;
  // time 模式
  start_at?: string;
  // number 模式
  template_id?: string;
  date?: string;
}

/**
 * POST /api/booking/reserve
 * time 模式 → book_time_slot;number 模式 → book_number(回號碼)。
 */
export async function POST(req: NextRequest) {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const body = (await req.json().catch(() => null)) as ReserveBody | null;
    if (!body) return fail("請求格式錯誤");
    if (!body.idToken) return fail("缺少 LINE 身分驗證");
    if (!body.patient_id) return fail("缺少病患");
    if (!body.doctor_id) return fail("缺少醫師");

    const visitType: "first" | "return" = body.visit_type === "first" ? "first" : "return";
    const isSelfPay = body.is_self_pay === true;

    // 驗 LINE 身分
    let lineUserId: string;
    try {
      lineUserId = (await verifyLiffIdToken(body.idToken)).sub;
    } catch {
      return fail("LINE 身分驗證失敗,請重新開啟預約頁", 401);
    }

    const svc = createServiceClient();

    // 確認病患屬於本診所且為此 LINE 身分
    const { data: patient, error: pErr } = await svc
      .from("patients")
      .select("id, clinic_id, line_user_id")
      .eq("id", body.patient_id)
      .maybeSingle();
    if (pErr) return fail(pErr.message, 500);
    if (!patient || patient.clinic_id !== CLINIC_ID) return fail("查無病患", 404);
    if (patient.line_user_id && patient.line_user_id !== lineUserId) {
      return fail("病患與目前 LINE 身分不符", 403);
    }

    const settings = await getClinicSettings(svc, CLINIC_ID);
    if (!settings) return fail("查無診所設定", 500);

    let appointmentId: string;
    let queueNumber: number | null = null;

    if (settings.booking_mode === "time") {
      if (!body.start_at) return fail("缺少預約時間");
      const { data, error } = await svc.rpc("book_time_slot", {
        p_clinic_id: CLINIC_ID,
        p_doctor_id: body.doctor_id,
        p_patient_id: body.patient_id,
        p_start_at: body.start_at,
        p_visit_type: visitType,
        p_is_self_pay: isSelfPay,
      });
      if (error) return fail(translateDbError(error.message));
      appointmentId = data as string;
    } else {
      if (!body.template_id) return fail("缺少門診段");
      if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return fail("date 格式須為 YYYY-MM-DD");
      const { data, error } = await svc.rpc("book_number", {
        p_clinic_id: CLINIC_ID,
        p_doctor_id: body.doctor_id,
        p_patient_id: body.patient_id,
        p_template_id: body.template_id,
        p_date: body.date,
        p_visit_type: visitType,
        p_is_self_pay: isSelfPay,
      });
      if (error) return fail(translateDbError(error.message));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return fail("掛號失敗", 500);
      appointmentId = row.appointment_id as string;
      queueNumber = row.queue_number as number;
    }

    // 回傳訂金狀態供成功頁顯示
    const { data: appt } = await svc
      .from("appointments")
      .select("deposit_status, deposit_amount, start_at")
      .eq("id", appointmentId)
      .single();

    return ok({
      appointment_id: appointmentId,
      queue_number: queueNumber,
      deposit_status: appt?.deposit_status ?? "none",
      deposit_amount: appt?.deposit_amount ?? 0,
      start_at: appt?.start_at ?? body.start_at ?? null,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "預約失敗", 500);
  }
}

/** RPC raise 的中文訊息直接回前端;其餘給通用訊息。 */
function translateDbError(msg: string): string {
  const known = ["時段已額滿", "本診已額滿", "已超過可預約時間", "此時段非門診時間", "查無此門診段"];
  const hit = known.find((k) => msg.includes(k));
  return hit ?? "此時段無法預約,請重新選擇";
}
