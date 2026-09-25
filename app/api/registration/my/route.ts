import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const response = fail("請重新開啟報名查詢頁後再查詢", 405);
  response.headers.set("Allow", "POST");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitResponse(request, "registration:my", 10);
  if (limited) return limited;
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("registration_no" in body) || !("phone" in body)) return fail("請提供報名編號與報名電話");
    const registrationNo = typeof body.registration_no === "string" ? body.registration_no.trim().toUpperCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
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
    const response = ok(data);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "查詢失敗", 500);
  }
}
