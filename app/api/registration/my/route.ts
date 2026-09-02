import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rate = await checkRateLimit(request, "registration:my", 10);
  if (!rate.allowed) return fail("查詢次數過多，請稍後再試", 429);
  try {
    const registrationNo = request.nextUrl.searchParams.get("registration_no")?.trim().toUpperCase() ?? "";
    const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
    if (!registrationNo || !phone) return fail("請提供報名編號與報名電話");
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const { data, error } = await service.from("registrations")
      .select("registration_no, status, payment_status, amount, name, created_at, events(title), event_sessions(name, start_at, end_at)")
      .eq("clinic_id", clinicId)
      .eq("registration_no", registrationNo)
      .eq("phone", phone)
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!data) return fail("找不到符合的報名資料，請確認編號與電話", 404);
    return ok(data);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "查詢失敗", 500);
  }
}
