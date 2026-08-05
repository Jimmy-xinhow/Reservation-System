import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { lineAccessTokenForDestination, pushMessages } from "@/lib/line";
import { formatAmount, formatEventDate } from "@/lib/registration";

export const REGISTRATION_NOTIFICATION_KINDS = ["pending", "confirmed", "waitlisted", "cancelled"] as const;
export type RegistrationNotificationKind = (typeof REGISTRATION_NOTIFICATION_KINDS)[number];

interface RegistrationRecord {
  id: string;
  clinic_id: string;
  event_id: string;
  session_id: string;
  registration_no: string;
  status: string;
  payment_status: string;
  amount: number;
  name: string;
  email: string | null;
  line_user_id: string | null;
}

interface NotificationResult {
  sent: number;
  failed: number;
  skipped: number;
}

export function notificationKindForStatus(status: string): RegistrationNotificationKind | null {
  return REGISTRATION_NOTIFICATION_KINDS.includes(status as RegistrationNotificationKind)
    ? (status as RegistrationNotificationKind)
    : null;
}

export async function notifyRegistrationStatus(
  svc: SupabaseClient,
  registrationId: string,
  kind: RegistrationNotificationKind,
  checkinToken?: string | null,
): Promise<NotificationResult> {
  const { data: registration, error: registrationError } = await svc
    .from("registrations")
    .select("id, clinic_id, event_id, session_id, registration_no, status, payment_status, amount, name, email, line_user_id")
    .eq("id", registrationId)
    .maybeSingle();
  if (registrationError) throw new Error(registrationError.message);
  if (!registration) return { sent: 0, failed: 0, skipped: 1 };

  const row = registration as RegistrationRecord;
  const [{ data: clinic, error: clinicError }, { data: event, error: eventError }, { data: session, error: sessionError }, { data: settings, error: settingsError }] = await Promise.all([
    svc.from("clinics").select("name, line_destination").eq("id", row.clinic_id).maybeSingle(),
    svc.from("events").select("title").eq("id", row.event_id).eq("clinic_id", row.clinic_id).maybeSingle(),
    svc.from("event_sessions").select("name, start_at, venue").eq("id", row.session_id).eq("clinic_id", row.clinic_id).maybeSingle(),
    svc.from("clinic_settings").select("email_enabled").eq("clinic_id", row.clinic_id).maybeSingle(),
  ]);
  if (clinicError || eventError || sessionError || settingsError) {
    throw new Error(clinicError?.message ?? eventError?.message ?? sessionError?.message ?? settingsError?.message ?? "讀取報名通知資料失敗");
  }

  const result: NotificationResult = { sent: 0, failed: 0, skipped: 0 };
  const message = buildMessage({ row, clinicName: clinic?.name ?? "", eventTitle: event?.title ?? "活動", sessionName: session?.name ?? "", startAt: session?.start_at ?? null, venue: session?.venue ?? null, kind, checkinToken: checkinToken ?? null });

  if (row.line_user_id) {
    const claim = await claimNotification(svc, row.clinic_id, row.id, kind, "line");
    if (claim) {
      try {
        const token = lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
        await pushMessages(row.line_user_id, [{ type: "text", text: message.text }], token);
        await finishNotification(svc, claim, "sent");
        result.sent += 1;
      } catch (error) {
        await finishNotification(svc, claim, "failed", error instanceof Error ? error.message : "LINE 通知失敗");
        result.failed += 1;
      }
    } else {
      result.skipped += 1;
    }
  } else {
    await recordSkippedNotification(svc, row.clinic_id, row.id, kind, "line", "顧客尚未綁定 LINE");
    result.skipped += 1;
  }

  const emailConfig = settings?.email_enabled ? emailConfigForClinic(row.clinic_id) : null;
  if (row.email && emailConfig) {
    const claim = await claimNotification(svc, row.clinic_id, row.id, kind, "email");
    if (claim) {
      try {
        await sendEmail(emailConfig, row.email, message.subject, message.html);
        await finishNotification(svc, claim, "sent");
        result.sent += 1;
      } catch (error) {
        await finishNotification(svc, claim, "failed", error instanceof Error ? error.message : "Email 通知失敗");
        result.failed += 1;
      }
    } else {
      result.skipped += 1;
    }
  } else {
    const reason = !row.email
      ? "顧客未提供 Email"
      : !settings?.email_enabled
        ? "品牌未啟用 Email"
        : "尚未設定 Email provider";
    await recordSkippedNotification(svc, row.clinic_id, row.id, kind, "email", reason);
    result.skipped += 1;
  }

  return result;
}

export async function processRegistrationNotificationQueue(svc: SupabaseClient): Promise<NotificationResult> {
  const summary: NotificationResult = { sent: 0, failed: 0, skipped: 0 };
  const pageSize = 250;
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  // Process every pending page in chronological order. Limiting to the newest
  // page makes older registration events unreachable on busy cron intervals.
  for (;;) {
    let query = svc
      .from("registration_status_events")
      .select("id, registration_id, to_status, created_at")
      .in("to_status", [...REGISTRATION_NOTIFICATION_KINDS])
      .is("notification_processed_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize);
    if (cursorCreatedAt && cursorId) {
      query = query.or(`created_at.gt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.gt.${cursorId})`);
    }

    const { data: events, error } = await query;
    if (error) throw new Error(error.message);
    const page = events ?? [];
    for (const event of page) {
      const kind = notificationKindForStatus(String(event.to_status));
      if (!kind) {
        await markRegistrationStatusEventProcessed(svc, String(event.id));
        continue;
      }
      try {
        const result = await notifyRegistrationStatus(svc, String(event.registration_id), kind);
        summary.sent += result.sent;
        summary.failed += result.failed;
        summary.skipped += result.skipped;
        if (result.failed === 0) await markRegistrationStatusEventProcessed(svc, String(event.id));
      } catch {
        summary.failed += 1;
      }
    }

    if (page.length < pageSize) break;
    const last = page[page.length - 1] as { created_at?: unknown; id?: unknown };
    cursorCreatedAt = typeof last.created_at === "string" ? last.created_at : null;
    cursorId = typeof last.id === "string" ? last.id : null;
    if (!cursorCreatedAt || !cursorId) break;
  }
  return summary;
}

async function markRegistrationStatusEventProcessed(svc: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await svc
    .from("registration_status_events")
    .update({ notification_processed_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("notification_processed_at", null);
  if (error) throw new Error(error.message);
}

async function claimNotification(
  svc: SupabaseClient,
  clinicId: string,
  registrationId: string,
  kind: RegistrationNotificationKind,
  channel: "line" | "email",
): Promise<string | null> {
  const { data: inserted, error: insertError } = await svc
    .from("registration_notification_logs")
    .insert({ clinic_id: clinicId, registration_id: registrationId, kind, channel, status: "sending", attempt_count: 1 })
    .select("id")
    .maybeSingle();
  if (!insertError && inserted?.id) return String(inserted.id);
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

  const { data: existing, error: existingError } = await svc
    .from("registration_notification_logs")
    .select("id, status, attempt_count, updated_at")
    .eq("clinic_id", clinicId)
    .eq("registration_id", registrationId)
    .eq("kind", kind)
    .eq("channel", channel)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing || existing.status === "sent") return null;
  if (existing.status === "sending" && new Date(existing.updated_at).getTime() > Date.now() - 10 * 60 * 1000) return null;

  const { data: claimed, error: claimError } = await svc
    .from("registration_notification_logs")
    .update({ status: "sending", attempt_count: Number(existing.attempt_count ?? 0) + 1, error: null, updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .eq("status", existing.status)
    .eq("updated_at", existing.updated_at)
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  return claimed?.id ? String(claimed.id) : null;
}

async function finishNotification(svc: SupabaseClient, id: string, status: "sent" | "failed", error?: string): Promise<void> {
  const { error: updateError } = await svc
    .from("registration_notification_logs")
    .update({ status, error: error ?? null, sent_at: status === "sent" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);
}

async function recordSkippedNotification(
  svc: SupabaseClient,
  clinicId: string,
  registrationId: string,
  kind: RegistrationNotificationKind,
  channel: "line" | "email",
  reason: string,
): Promise<void> {
  const { error } = await svc
    .from("registration_notification_logs")
    .insert({ clinic_id: clinicId, registration_id: registrationId, kind, channel, status: "skipped", attempt_count: 0, error: reason });
  if (error && error.code !== "23505") throw new Error(error.message);
}

function buildMessage(args: {
  row: RegistrationRecord;
  clinicName: string;
  eventTitle: string;
  sessionName: string;
  startAt: string | null;
  venue: string | null;
  kind: RegistrationNotificationKind;
  checkinToken: string | null;
}): { text: string; subject: string; html: string } {
  const labels: Record<RegistrationNotificationKind, string> = { pending: "待付款", confirmed: "已確認", waitlisted: "候補中", cancelled: "已取消" };
  const status = labels[args.kind];
  const lines = [
    `${args.clinicName || "品牌"}｜${args.eventTitle}`,
    `報名編號：${args.row.registration_no}`,
    `目前狀態：${status}`,
    args.sessionName ? `場次：${args.sessionName}` : "",
    args.startAt ? `時間：${formatEventDate(args.startAt)}` : "",
    args.venue ? `地點：${args.venue}` : "",
    `金額：${formatAmount(Number(args.row.amount))}`,
  ].filter(Boolean);
  if (args.kind === "pending") lines.push("請於報名頁完成付款，逾期未付款將自動取消。\n");
  if (args.kind === "waitlisted") lines.push("目前為候補，若有名額釋出，系統會再通知您。\n");
  if (args.kind === "confirmed" && args.checkinToken) lines.push(`報到憑證：${args.checkinToken}`);
  if (args.kind === "cancelled") lines.push("如需重新參加，請回到公開活動頁重新報名。\n");
  const text = lines.join("\n");
  const subject = `${args.eventTitle}｜報名${status}`;
  const html = `<div style="font-family:sans-serif;line-height:1.8;max-width:560px"><h2>${escapeHtml(subject)}</h2><p>${lines.map((line) => escapeHtml(line).replace(/\n/g, "<br>")).join("<br>")}</p></div>`;
  return { text, subject, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
