import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, getClinicSettings, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { checkRateLimit } from "@/lib/rate-limit";
import { createBrowserBookingToken, verifyBrowserBookingToken } from "@/lib/browser-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "membership:portal", 8);
  if (!rate.allowed) return fail("查詢次數過多，請稍後再試", 429);
  try {
    const body = await request.json().catch(() => null) as { browser_token?: string; name?: string; phone?: string; birthday?: string } | null;
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const settings = await getClinicSettings(service, clinicId);
    if (!settings) return fail("品牌設定不存在", 503);
    if (!settings.memberships_enabled) return fail("此品牌目前未啟用會員與套票", 403);
    let patientId: string | null = null;
    const identity = body?.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
    if (identity) {
      if (identity.clinicId !== clinicId) return fail("品牌入口不相符", 403);
      patientId = identity.patientId;
    } else {
      const name = body?.name?.trim() ?? ""; const phone = body?.phone?.trim() ?? ""; const birthday = body?.birthday?.trim() ?? "";
      if (!name || !phone || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail("請填寫姓名、電話與出生年月日");
      const { data, error } = await service.rpc("create_or_get_public_patient", { p_clinic_id: clinicId, p_name: name, p_phone: phone, p_birthday: birthday, p_line_user_id: null });
      if (error) return fail(error.message, 409);
      const row = Array.isArray(data) ? data[0] : data;
      patientId = row?.patient_id ?? null;
    }
    if (!patientId) return fail("找不到會員資料", 404);
    const [{ data, error }, { data: plans, error: plansError }] = await Promise.all([
      service.from("patient_memberships").select("membership_code, status, credits_total, credits_remaining, starts_at, expires_at, membership_plans(name, description, price)").eq("clinic_id", clinicId).eq("patient_id", patientId).order("created_at", { ascending: false }),
      service.from("membership_plans").select("id, name, description, price, credits_total, valid_days, usage_scope, service_id").eq("clinic_id", clinicId).eq("active", true).order("created_at", { ascending: false }),
    ]);
    if (error) return fail(error.message, 500);
    if (plansError) return fail(plansError.message, 500);
    const plansWithPrices = await Promise.all((plans ?? []).map(async (plan) => {
      const { data: price, error: priceError } = await service.rpc("get_membership_plan_price", { p_clinic_id: clinicId, p_plan_id: plan.id, p_patient_id: patientId });
      if (priceError) throw new Error(priceError.message);
      const priceRow = Array.isArray(price) ? price[0] : price;
      return { ...plan, price: Number((priceRow as { price?: number } | null)?.price ?? plan.price) };
    }));
    return ok({ browser_token: identity ? body?.browser_token : createBrowserBookingToken(clinicId, patientId), memberships: data ?? [], plans: plansWithPrices });
  } catch (error) { return fail(error instanceof Error ? error.message : "會員資料查詢失敗", 500); }
}
