import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, getClinicSettings, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BindLineBody {
  idToken?: string;
  name?: string;
  phone?: string;
  birthday?: string;
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "customer:bind-line", 8);
  if (!rate.allowed) return fail("綁定次數過多，請稍後再試", 429);

  try {
    const body = await request.json().catch(() => null) as BindLineBody | null;
    const name = body?.name?.trim() ?? "";
    const phone = body?.phone?.trim() ?? "";
    const birthday = body?.birthday?.trim() ?? "";
    const idToken = body?.idToken?.trim() ?? "";
    if (!name || name.length > 100) return fail("請填寫正確姓名");
    if (!phone || phone.length > 40) return fail("請填寫正確電話");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail("請填寫出生年月日");
    if (!idToken) return fail("缺少 LINE 身分驗證", 401);

    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const settings = await getClinicSettings(service, clinicId);
    if (!settings) return fail("品牌設定不存在", 503);
    if (!settings.memberships_enabled) return fail("此品牌目前未啟用會員與套票", 403);

    let lineUserId: string;
    try {
      lineUserId = (await verifyClinicLiffIdToken(service, clinicId, idToken)).sub;
    } catch {
      return fail("LINE 身分驗證失敗，請從官方帳號重新開啟。", 401);
    }

    const { data, error } = await service.rpc("create_or_get_public_patient", {
      p_clinic_id: clinicId,
      p_name: name,
      p_phone: phone,
      p_birthday: birthday,
      p_line_user_id: lineUserId,
    });
    if (error) return fail(bindLineError(error.message), 409);
    const patient = Array.isArray(data) ? data[0] : data;
    if (!patient?.patient_id) return fail("會員綁定失敗，請稍後再試", 500);
    return ok({ patient_id: patient.patient_id, reused: patient.reused === true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "會員綁定失敗", 500);
  }
}

function bindLineError(message: string): string {
  if (message.includes("bound to another LINE")) return "這筆顧客資料已綁定其他 LINE 帳號，請洽品牌人員協助。";
  if (message.includes("phone already")) return "電話已登記其他顧客，請確認姓名與生日或洽品牌人員。";
  if (message.includes("patient limit")) return "此電話可綁定的人數已達上限，請洽品牌人員。";
  return "姓名、電話或生日與顧客資料不符，請確認後再試。";
}
