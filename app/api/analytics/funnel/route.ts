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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE = /^[a-z][a-z0-9_-]{0,79}$/i;

function safeMetadata(input: Record<string, unknown>): Record<string, string | number | boolean> | null {
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "event_id" || key === "plan_id") {
      // Older customer pages send these IDs, but no report uses them.
      if (typeof value !== "string" || !UUID.test(value)) return null;
    } else if (key === "booking_mode") {
      if (value !== "time" && value !== "number") return null;
      metadata.booking_mode = value;
    } else if (key === "waitlist" || key === "deposit_pending") {
      if (typeof value !== "boolean") return null;
      metadata[key] = value;
    } else if (key === "series_count" || key === "rm_slot") {
      const upper = key === "series_count" ? 12 : 20;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > upper) return null;
      metadata[key] = value;
    } else if (key === "rm_version") {
      if (typeof value !== "string" || !UUID.test(value)) return null;
      metadata.rm_version = value;
    } else {
      return null;
    }
  }
  return metadata;
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "analytics:funnel", 60);
  if (!rate.allowed) return fail("事件過於頻繁", rate.unavailable ? 503 : 429);
  try {
    const parsed: unknown = await request.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("事件格式不正確", 400);
    const body = parsed as Record<string, unknown>;
    const eventName = typeof body.event_name === "string" ? body.event_name.trim() : "";
    const anonymousId = typeof body.anonymous_id === "string" ? body.anonymous_id.trim() : "";
    if (!EVENT_NAMES.has(eventName as FunnelEventName) || !/^[a-zA-Z0-9_-]{8,128}$/.test(anonymousId) || /^0\d{8,9}$/.test(anonymousId)) {
      return fail("事件格式不正確", 400);
    }
    const inputMetadata = body.metadata ?? {};
    if (!inputMetadata || typeof inputMetadata !== "object" || Array.isArray(inputMetadata)) return fail("事件格式不正確", 400);
    if (JSON.stringify(inputMetadata).length > 1200) return fail("事件資料過大", 400);
    const metadata = safeMetadata(inputMetadata as Record<string, unknown>);
    if (!metadata) return fail("事件格式不正確", 400);
    const rawSource = body.source;
    if (rawSource != null && typeof rawSource !== "string") return fail("事件格式不正確", 400);
    const source = typeof rawSource === "string" ? rawSource.trim() : "";
    const safeSource = SOURCE.test(source) && !/0\d{8,9}/.test(source) ? source : null;
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const { error } = await service.from("funnel_events").insert({
      clinic_id: clinicId,
      event_name: eventName,
      anonymous_id: anonymousId,
      source: safeSource,
      metadata,
    });
    if (error) return fail("事件記錄失敗", 500);
    return ok({ accepted: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "事件記錄失敗", 500);
  }
}
