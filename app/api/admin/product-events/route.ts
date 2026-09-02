import { NextRequest } from "next/server";
import { getOptionalMember } from "@/lib/admin";
import { fail, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_NAMES = new Set([
  "settings_view",
  "settings_exit",
  "settings_submit",
  "permission_help_requested",
]);

function safeMetadata(input: unknown): Record<string, string | number | boolean | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (typeof raw === "string") result[key] = raw.slice(0, 120);
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === "boolean" || raw === null) result[key] = raw;
  }
  return result;
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "admin:product-events", 80);
  if (!rate.allowed) return fail("事件過於頻繁", 429);
  try {
    const member = await getOptionalMember();
    if (!member) return fail("請先登入品牌後台", 401);
    const body = await request.json().catch(() => null) as {
      event_name?: string;
      session_id?: string;
      pathname?: string;
      metadata?: unknown;
    } | null;
    const eventName = body?.event_name?.trim() ?? "";
    const sessionId = body?.session_id?.trim() ?? "";
    const pathname = body?.pathname?.trim().slice(0, 240) || null;
    if (!EVENT_NAMES.has(eventName) || !/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) return fail("事件格式不正確", 400);
    const metadata = safeMetadata(body?.metadata);
    if (JSON.stringify(metadata).length > 1200) return fail("事件資料過大", 400);
    const { error } = await createServiceClient().from("admin_product_events").insert({
      clinic_id: member.clinicId,
      event_name: eventName,
      session_id: sessionId,
      actor_scope: member.accessType === "brand_admin" ? "brand_admin" : "brand_employee",
      pathname,
      metadata,
    });
    if (error) return fail("事件記錄失敗", 500);
    return ok({ accepted: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "事件記錄失敗", 500);
  }
}
