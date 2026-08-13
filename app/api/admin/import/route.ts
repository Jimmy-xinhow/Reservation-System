import { NextRequest } from "next/server";
import { getOptionalMember, hasBrandPermission } from "@/lib/admin";
import { fail, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTITIES = new Set(["patients", "services", "memberships"]);

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "admin:csv-import", 10);
  if (!rate.allowed) return fail("匯入要求過於頻繁", 429);
  try {
    const member = await getOptionalMember();
    if (!member) return fail("請先登入品牌後台", 401);
    if (!hasBrandPermission(member, "brand.manage")) return fail("需要品牌管理權限", 403);
    const body = await request.json().catch(() => null) as { entity?: string; idempotency_key?: string; rows?: unknown } | null;
    const entity = body?.entity?.trim() ?? "";
    const key = body?.idempotency_key?.trim() ?? "";
    if (!ENTITIES.has(entity) || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) return fail("匯入參數不正確", 400);
    if (!Array.isArray(body?.rows) || body.rows.length < 1 || body.rows.length > 500) return fail("每批必須包含 1 至 500 筆", 400);
    if (JSON.stringify(body.rows).length > 800_000) return fail("CSV 內容過大", 413);
    const service = createServiceClient();
    const { data: jobId, error } = await service.rpc("execute_data_import", {
      p_clinic_id: member.clinicId,
      p_actor_user_id: member.user.id,
      p_entity: entity,
      p_idempotency_key: key,
      p_rows: body.rows,
    });
    if (error || !jobId) return fail(`匯入失敗：${error?.message ?? "沒有工作編號"}`, 400);
    const { data: job, error: jobError } = await service
      .from("data_import_jobs")
      .select("id, entity, status, total_rows, imported_rows, failed_rows, error_summary, created_at, completed_at")
      .eq("id", jobId)
      .eq("clinic_id", member.clinicId)
      .single();
    if (jobError) return fail("無法讀取匯入結果", 500);
    return ok(job);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "匯入失敗", 500);
  }
}
