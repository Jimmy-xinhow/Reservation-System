import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getClinicSettings } from "@/lib/http";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { lineAccessTokenForDestination, pushMessages } from "@/lib/line";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReminderKind = "low_balance" | "expiry";
type Channel = "line" | "email";

interface MembershipRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  membership_code: string;
  credits_remaining: number;
  expires_at: string | null;
  membership_plans: { name: string } | { name: string }[] | null;
  patients: { name: string; line_user_id: string | null; email: string | null } | { name: string; line_user_id: string | null; email: string | null }[] | null;
}

interface ClinicRow { id: string; name: string; line_destination: string | null }

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function taipeiDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  try {
    const service = createServiceClient();
    const { data: clinics, error } = await service.from("clinics").select("id, name, line_destination").eq("active", true);
    if (error) throw new Error(error.message);
    const summary = { candidates: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0 };
    const errors: string[] = [];
    for (const clinic of (clinics ?? []) as ClinicRow[]) {
      try {
        const result = await runClinic(service, clinic);
        summary.candidates += result.candidates; summary.sent += result.sent; summary.failed += result.failed; summary.skipped += result.skipped; summary.duplicate += result.duplicate;
      } catch (clinicError) { errors.push(`${clinic.id}: ${clinicError instanceof Error ? clinicError.message : "membership reminder failed"}`); }
    }
    return Response.json({ ok: errors.length === 0, ...summary, errors });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "membership reminder failed" }, { status: 500 });
  }
}

async function runClinic(service: SupabaseClient, clinic: ClinicRow) {
  const settings = await getClinicSettings(service, clinic.id);
  if (!settings) throw new Error("brand settings unavailable");
  const { data, error } = await service.from("patient_memberships")
    .select("id, clinic_id, patient_id, membership_code, credits_remaining, expires_at, membership_plans(name), patients(name, line_user_id, email)")
    .eq("clinic_id", clinic.id).eq("status", "active").order("id").limit(2000);
  if (error) throw new Error(error.message);
  const now = new Date();
  const expiryDays = numberEnv("MEMBERSHIP_EXPIRY_NOTICE_DAYS", 7);
  const lowBalanceThreshold = Math.max(1, Math.floor(numberEnv("MEMBERSHIP_LOW_BALANCE_THRESHOLD", 1)));
  const expiryLimit = now.getTime() + expiryDays * 24 * 60 * 60 * 1000;
  const rows = (data ?? []) as unknown as MembershipRow[];
  const result = { candidates: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  let lineToken: string | null = null; let lineTokenError: string | null = null;
  if (rows.some((row) => Boolean(one(row.patients)?.line_user_id))) {
    try { lineToken = lineAccessTokenForDestination(clinic.line_destination ?? undefined); }
    catch (error) { lineTokenError = error instanceof Error ? error.message : "LINE access token unavailable"; }
  }
  const emailConfig = settings.email_enabled ? emailConfigForClinic(clinic.id) : null;
  for (const row of rows) {
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
    const lowBalance = row.credits_remaining <= lowBalanceThreshold;
    const expiry = expiresAt !== null && expiresAt > now.getTime() && expiresAt <= expiryLimit;
    if (!lowBalance && !expiry) continue;
    result.candidates += 1;
    const plan = one(row.membership_plans); const patient = one(row.patients);
    const notices: Array<{ kind: ReminderKind; windowKey: string }> = [];
    if (lowBalance) notices.push({ kind: "low_balance", windowKey: taipeiDate(now) });
    if (expiry && expiresAt !== null) notices.push({ kind: "expiry", windowKey: taipeiDate(new Date(expiresAt)) });
    for (const notice of notices) for (const channel of ["line", "email"] as const) {
      const claim = await claimNotification(service, row, notice.kind, channel, notice.windowKey);
      if (claim === "duplicate") { result.duplicate += 1; continue; }
      if (!claim) continue;
      if (channel === "line" && !patient?.line_user_id) { await finishNotification(service, claim, "skipped", "customer has no LINE identity"); result.skipped += 1; continue; }
      if (channel === "line" && !lineToken) { await finishNotification(service, claim, "failed", lineTokenError ?? "LINE access token unavailable"); result.failed += 1; continue; }
      if (channel === "email" && (!patient?.email || !emailConfig)) { await finishNotification(service, claim, "skipped", "customer email or email provider unavailable"); result.skipped += 1; continue; }
      const body = notice.kind === "low_balance"
        ? `${clinic.name}提醒：您的${plan?.name ?? "會員方案"}目前剩餘 ${row.credits_remaining} 堂，請於需要時聯繫品牌櫃檯。`
        : `${clinic.name}提醒：您的${plan?.name ?? "會員方案"}將於 ${taipeiDate(new Date(expiresAt!))} 到期，目前剩餘 ${row.credits_remaining} 堂。`;
      try {
        if (channel === "line") await pushMessages(patient!.line_user_id!, [{ type: "text", text: body }], lineToken!);
        else await sendEmail(emailConfig!, patient!.email!, notice.kind === "low_balance" ? "會員堂數提醒" : "會員期限提醒", `<div style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(body)}</div>`);
        await finishNotification(service, claim, "sent"); result.sent += 1;
      } catch (sendError) { await finishNotification(service, claim, "failed", sendError instanceof Error ? sendError.message : "notification failed"); result.failed += 1; }
    }
  }
  return result;
}

async function claimNotification(service: SupabaseClient, row: MembershipRow, kind: ReminderKind, channel: Channel, windowKey: string): Promise<string | "duplicate" | null> {
  const { data, error } = await service.from("membership_notification_logs").insert({ clinic_id: row.clinic_id, patient_membership_id: row.id, patient_id: row.patient_id, kind, channel, window_key: windowKey, status: "claimed" }).select("id").maybeSingle();
  if (error) { if (error.code === "23505") return "duplicate"; throw new Error(error.message); }
  return (data?.id as string | undefined) ?? null;
}

async function finishNotification(service: SupabaseClient, id: string, status: "sent" | "failed" | "skipped", error: string | null = null): Promise<void> {
  const { error: updateError } = await service.from("membership_notification_logs").update({ status, error, sent_at: status === "sent" ? new Date().toISOString() : null }).eq("id", id);
  if (updateError) throw new Error(updateError.message);
}
