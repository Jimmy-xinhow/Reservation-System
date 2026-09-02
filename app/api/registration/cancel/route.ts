import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { notificationKindForStatus, notifyRegistrationStatus } from "@/lib/registration-notifications";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rate = await checkRateLimit(req, "registration:cancel", 8);
  if (!rate.allowed) {
    const response = fail("請稍後再試", 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }

  try {
    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    const token = body?.token?.trim() ?? "";
    if (!token) return fail("缺少取消憑證", 400);
    if (token.length > 128) return fail("取消憑證格式錯誤", 400);

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { data: registration, error: lookupError } = await svc
      .from("registrations")
      .select("clinic_id")
      .eq("clinic_id", clinicId)
      .eq("checkin_token_hash", tokenHash)
      .maybeSingle();
    if (lookupError) return fail(lookupError.message, 500);
    if (!registration?.clinic_id) return fail("取消憑證無效", 404);

    const { data, error } = await svc.rpc("cancel_registration", {
      p_clinic_id: clinicId,
      p_token: token,
    });
    if (error) return fail(error.message, 409);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail("取消失敗", 409);
    const notificationKind = notificationKindForStatus(String(row.registration_status));
    if (notificationKind) await notifyRegistrationStatus(svc, String(row.registration_id), notificationKind).catch(() => undefined);
    return ok(row);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "取消報名失敗", 500);
  }
}
