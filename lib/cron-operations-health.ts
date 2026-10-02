export const CRON_JOB_EXPECTATIONS = [
  { job: "reminders", label: "行前提醒", maxAgeMinutes: 90 },
  { job: "marketing", label: "CRM 行銷", maxAgeMinutes: 90 },
  { job: "membership", label: "會員通知", maxAgeMinutes: 90 },
  { job: "followups", label: "顧客回訪", maxAgeMinutes: 15 },
  { job: "registration", label: "報名與期限", maxAgeMinutes: 15 },
  { job: "richmenu", label: "LINE 選單排程", maxAgeMinutes: 15 },
  { job: "subscription-freezes", label: "訂閱凍結", maxAgeMinutes: 26 * 60 },
] as const;

export interface CronRunSummary {
  status: string;
  result_code: string;
  http_status: number | null;
  completed_at: string;
}

export type CronRunState = "healthy" | "failed" | "stale" | "missing" | "invalid_time";

export function cronRunState(
  latest: CronRunSummary | null,
  maxAgeMinutes: number,
  now = Date.now(),
): CronRunState {
  if (!latest) return "missing";
  const completedAt = Date.parse(latest.completed_at);
  if (!Number.isFinite(completedAt) || completedAt > now + 60_000) return "invalid_time";
  if (latest.status !== "success" || latest.result_code !== "success") return "failed";
  return now - completedAt > maxAgeMinutes * 60_000 ? "stale" : "healthy";
}
