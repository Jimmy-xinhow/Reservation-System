import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/patient
 * body: { idToken, name, phone }
 * 以 clinic_id+phone 建立或取得顧客;依設定檢查一電話多顧客上限。
 * 順手存入經驗證的 line_user_id。
 */
export async function POST(req: NextRequest) {
  try {
    const rate = await checkRateLimit(req, "booking:patient", 10);
    if (!rate.allowed) {
      const response = fail("請稍後再試", 429);
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }
    const body = (await req.json().catch(() => null)) as {
      idToken?: string;
      name?: string;
      phone?: string;
      birthday?: string;
    } | null;
    if (!body) return fail("請求格式錯誤");

    const name = body.name?.trim();
    const phone = body.phone?.trim();
    const birthday = body.birthday?.trim();
    if (!name) return fail("請填寫姓名");
    if (!phone) return fail("請填寫電話");
    if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail("請填寫出生年月日");
    if (!body.idToken) return fail("缺少 LINE 身分驗證");

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    // 驗證 LINE 身分(信任前先驗)，且 aud 必須符合目前品牌渠道。
    let lineUserId: string;
    try {
      const profile = await verifyClinicLiffIdToken(svc, clinicId, body.idToken);
      lineUserId = profile.sub;
    } catch {
      return fail("LINE 身分驗證失敗，請重新開啟預約頁。", 401);
    }

    const settings = await getClinicSettings(svc, clinicId);
    if (settings && !settings.public_booking_enabled) return fail("目前暫停線上預約", 403);
    if (!settings) return fail("查無品牌設定", 500);

    const { data, error } = await svc.rpc("create_or_get_public_patient", {
      p_clinic_id: clinicId,
      p_name: name,
      p_phone: phone,
      p_birthday: birthday,
      p_line_user_id: lineUserId,
    });
    if (error) return fail(translatePatientError(error.message), 409);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.patient_id) return fail("建立顧客失敗", 500);
    return ok({ patient_id: row.patient_id, reused: row.reused === true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "建立顧客失敗", 500);
  }
}

function translatePatientError(message: string): string {
  if (message.includes("bound to another LINE")) return "此顧客資料已綁定其他 LINE 帳號，請確認姓名、電話與生日";
  if (message.includes("patient limit")) return "此電話可登記人數已達上限";
  if (message.includes("phone already")) return "此電話已登記其他顧客，請洽服務人員";
  if (message.includes("public booking")) return "目前暫停線上預約";
  return "建立顧客失敗，請稍後再試";
}
