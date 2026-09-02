import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { checkRateLimit } from "@/lib/rate-limit";
import type { FunnelEventName } from "@/lib/funnel-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_NAMES = new Set<FunnelEventName>([
  "portal_view", "booking_view", "booking_start", "booking_success",
  "registration_view", "registration_start", "registration_success",
  "membership_view", "membership_lookup", "membership_purchase_start",
]);

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "analytics:funnel", 60);
  if (!rate.allowed) return fail("事件過於頻繁", 429);
  try {
    const body = await request.json().catch(() => null) as { event_name?: string; anonymous_id?: string; source?: string | null; metadata?: Record<string, unknown> } | null;
    const eventName = body?.event_name?.trim() as FunnelEventName | undefined;
    const anonymousId = body?.anonymous_id?.trim() ?? "";
    if (!eventName || !EVENT_NAMES.has(eventName) || !/^[a-zA-Z0-9_-]{8,128}$/.test(anonymousId)) return fail("事件格式不正確", 400);
    const metadata = body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};
    if (JSON.stringify(metadata).length > 1200) return fail("事件資料過大", 400);
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const { error } = await service.from("funnel_events").insert({
      clinic_id: clinicId,
      event_name: eventName,
      anonymous_id: anonymousId,
      source: typeof body?.source === "string" ? body.source.trim().slice(0, 80) || null : null,
      metadata,
    });
    if (error) return fail("事件記錄失敗", 500);
    return ok({ accepted: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "事件記錄失敗", 500);
  }
}
