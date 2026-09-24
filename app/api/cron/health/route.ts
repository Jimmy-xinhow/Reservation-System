import { fail } from "@/lib/http";
import { CRON_JOB_EXPECTATIONS, cronRunState, type CronRunSummary } from "@/lib/cron-operations-health";
import { createServiceClient } from "@/lib/supabase";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobs = new Set([
  "reminders", "marketing", "membership", "followups", "registration",
  "richmenu", "subscription-freezes",
]);
const resultCodes = new Set([
  "success", "http_failed", "invalid_or_failed_result", "partial_failure",
  "timeout", "request_failed",
]);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const requiredKeys = ["run_id", "job", "mode", "status", "result_code", "http_status"];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const service = createServiceClient();
    const results = await Promise.all(CRON_JOB_EXPECTATIONS.map(({ job }) =>
      service.from("cron_job_runs").select("status,result_code,http_status,completed_at")
        .eq("mode", "global").eq("job", job)
        .order("completed_at", { ascending: false }).limit(1),
    ));
    if (results.some((result) => result.error || !Array.isArray(result.data))) {
      return fail("排程健康暫時無法確認", 503);
    }
    const now = Date.now();
    const checks = CRON_JOB_EXPECTATIONS.map(({ job, maxAgeMinutes }, index) => ({
      job,
      state: cronRunState((results[index].data?.[0] ?? null) as CronRunSummary | null, maxAgeMinutes, now),
    }));
    const healthy = checks.every(({ state }) => state === "healthy");
    return Response.json({ ok: healthy, jobs: checks }, {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return fail("排程健康暫時無法確認", 503);
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("排程健康資料格式錯誤", 400);
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).length !== requiredKeys.length ||
      Object.keys(input).some((key) => !requiredKeys.includes(key)) ||
      typeof input.run_id !== "string" || !uuid.test(input.run_id) ||
      typeof input.job !== "string" || !jobs.has(input.job) ||
      (input.mode !== "global" && input.mode !== "scoped") ||
      (input.status !== "success" && input.status !== "failed") ||
      typeof input.result_code !== "string" || !resultCodes.has(input.result_code) ||
      (input.status === "success") !== (input.result_code === "success") ||
      (input.http_status !== null && (typeof input.http_status !== "number" ||
        !Number.isInteger(input.http_status) || input.http_status < 100 || input.http_status > 599)) ||
      (input.status === "success" && input.http_status !== 200)) {
    return fail("排程健康資料格式錯誤", 400);
  }

  try {
    const service = createServiceClient();
    const record = {
      run_id: input.run_id, job: input.job, mode: input.mode,
      status: input.status, result_code: input.result_code, http_status: input.http_status,
    };
    const { error } = await service.from("cron_job_runs").insert(record);
    if (!error) return Response.json({ ok: true, duplicate: false });
    if (error.code !== "23505") return fail("排程健康紀錄暫時無法寫入", 500);
    const { data: existing, error: readError } = await service.from("cron_job_runs")
      .select("mode,status,result_code,http_status")
      .eq("run_id", input.run_id).eq("job", input.job).maybeSingle();
    if (readError || !existing) return fail("排程健康紀錄暫時無法確認", 500);
    if (existing.mode !== record.mode || existing.status !== record.status ||
        existing.result_code !== record.result_code || existing.http_status !== record.http_status) {
      return fail("同一次排程已有不同結果", 409);
    }
    return Response.json({ ok: true, duplicate: true });
  } catch {
    return fail("排程健康紀錄暫時無法寫入", 500);
  }
}
