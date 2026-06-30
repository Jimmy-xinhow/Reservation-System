import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/availability?doctor_id=...&date=YYYY-MM-DD
 * 依 clinic_settings.booking_mode 回傳可約時段(time)或可掛診次(number)。
 */
export async function GET(req: NextRequest) {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const sp = req.nextUrl.searchParams;
    const doctorId = sp.get("doctor_id");
    const date = sp.get("date");
    if (!doctorId) return fail("缺少 doctor_id");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("date 格式須為 YYYY-MM-DD");

    const svc = createServiceClient();
    const settings = await getClinicSettings(svc, CLINIC_ID);
    if (!settings) return fail("查無診所設定", 500);

    if (settings.booking_mode === "time") {
      const { data, error } = await svc.rpc("get_available_slots", {
        p_clinic_id: CLINIC_ID,
        p_doctor_id: doctorId,
        p_date: date,
      });
      if (error) return fail(error.message, 500);
      return ok({ mode: "time", slots: data ?? [] });
    } else {
      const { data, error } = await svc.rpc("get_available_sessions", {
        p_clinic_id: CLINIC_ID,
        p_doctor_id: doctorId,
        p_date: date,
      });
      if (error) return fail(error.message, 500);
      return ok({ mode: "number", sessions: data ?? [] });
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "查詢空檔失敗", 500);
  }
}
