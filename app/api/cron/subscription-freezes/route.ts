import { fail } from "@/lib/http";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { readCronRecordScope, type CronRecordScope } from "@/lib/cron-scope";
import { cronScopeDenied } from "@/lib/cron-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const scope = await readCronRecordScope(request, "subscription_ids");
  if (scope instanceof Response) return scope;
  return runSubscriptionFreezes(request, scope);
}

export async function GET(request: NextRequest) { return runSubscriptionFreezes(request); }

async function runSubscriptionFreezes(request: NextRequest, scope?: CronRecordScope) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const denied = cronScopeDenied(scope?.clinicId);
  if (denied) return denied;
  try {
    const service = createServiceClient();
    const { data, error } = scope
      ? await service.rpc("sync_subscription_freezes_for_clinic", { p_clinic_id: scope.clinicId, p_subscription_ids: scope.recordIds })
      : await service.rpc("sync_subscription_freezes");
    if (error) return fail(error.message, 500);
    return Response.json({ ok: true, changed: Number(data ?? 0), timezone: "Asia/Taipei" });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "排程執行失敗", 500);
  }
}
