import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, "registration:events", 30);
  if (limited) return limited;
  try {
    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);
    const { data: settings, error: settingsError } = await svc
      .from("clinic_settings")
      .select("public_registration_enabled")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (settingsError) return fail(settingsError.message, 500);
    if (!settings) return fail("公開報名設定尚未完成", 503);
    if (settings.public_registration_enabled === false) return ok({ events: [] });

    const { data, error } = await svc
      .from("events")
      .select("id, clinic_id, slug, title, description, cover_url, registration_open_at, registration_close_at")
      .eq("clinic_id", clinicId)
      .eq("status", "published")
      .eq("access_mode", "public")
      .order("registration_open_at", { ascending: true, nullsFirst: false });
    if (error) return fail(error.message, 500);
    const now = Date.now();
    const events = (data ?? []).filter((event) => {
      const opensAt = event.registration_open_at ? new Date(event.registration_open_at).getTime() : null;
      const closesAt = event.registration_close_at ? new Date(event.registration_close_at).getTime() : null;
      return (opensAt === null || opensAt <= now) && (closesAt === null || closesAt > now);
    });
    return ok({ events });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "讀取活動失敗", 500);
  }
}
