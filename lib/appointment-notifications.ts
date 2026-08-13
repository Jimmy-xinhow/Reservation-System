import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { lineAccessTokenForDestination, pushMessages } from "@/lib/line";

export const APPOINTMENT_NOTIFICATION_KINDS = ["pending", "confirmed", "cancelled", "rescheduled"] as const;
export type AppointmentNotificationKind = (typeof APPOINTMENT_NOTIFICATION_KINDS)[number];

interface AppointmentRecord {
  id: string;
  clinic_id: string;
  patient_id: string;
  start_at: string;
  end_at: string;
  status: string;
  deposit_status: string;
  deposit_amount: number;
  queue_number: number | null;
  clinic_name: string;
  line_destination: string | null;
  patient_name: string;
  patient_email: string | null;
  patient_line_user_id: string | null;
  doctor_name: string;
  service_name: string | null;
  email_enabled: boolean;
}

interface NotificationResult {
  sent: number;
  failed: number;
  skipped: number;
}

export function appointmentNotificationKindForState(
  status: string,
  depositStatus: string,
): AppointmentNotificationKind | null {
  if (status === "cancelled") return "cancelled";
  if (status === "confirmed") return "confirmed";
  if (status === "booked") return depositStatus === "pending" ? "pending" : "confirmed";
  return null;
}

export async function notifyAppointmentStatus(
  svc: SupabaseClient,
  appointmentId: string,
  kind: AppointmentNotificationKind,
): Promise<NotificationResult> {
  const appointment = await loadAppointment(svc, appointmentId);
  if (!appointment) return { sent: 0, failed: 0, skipped: 1 };

  const result: NotificationResult = { sent: 0, failed: 0, skipped: 0 };
  const message = buildMessage(appointment, kind);

  if (appointment.patient_line_user_id) {
    const claim = await claimNotification(svc, appointment, kind, "line");
    if (claim) {
      try {
        const token = lineAccessTokenForDestination(appointment.line_destination ?? undefined);
        await pushMessages(appointment.patient_line_user_id, [{ type: "text", text: message.text }], token);
        await finishNotification(svc, claim, "sent");
        result.sent += 1;
      } catch (error) {
        await finishNotification(svc, claim, "failed", error instanceof Error ? error.message : "LINE notification failed");
        result.failed += 1;
      }
    } else {
      result.skipped += 1;
    }
  } else {
    await recordSkippedNotification(svc, appointment.clinic_id, appointment.id, kind, "line", "顧客尚未綁定 LINE");
    result.skipped += 1;
  }

  const emailConfig = appointment.email_enabled ? emailConfigForClinic(appointment.clinic_id) : null;
  if (appointment.patient_email && emailConfig) {
    const claim = await claimNotification(svc, appointment, kind, "email");
    if (claim) {
      try {
        await sendEmail(emailConfig, appointment.patient_email, message.subject, message.html);
        await finishNotification(svc, claim, "sent");
        result.sent += 1;
      } catch (error) {
        await finishNotification(svc, claim, "failed", error instanceof Error ? error.message : "Email notification failed");
        result.failed += 1;
      }
    } else {
      result.skipped += 1;
    }
  } else {
    const reason = !appointment.patient_email
      ? "顧客未提供 Email"
      : !appointment.email_enabled
        ? "品牌未啟用 Email"
        : "尚未設定 Email provider";
    await recordSkippedNotification(svc, appointment.clinic_id, appointment.id, kind, "email", reason);
    result.skipped += 1;
  }

  return result;
}

export async function processAppointmentNotificationQueue(svc: SupabaseClient): Promise<NotificationResult> {
  const summary: NotificationResult = { sent: 0, failed: 0, skipped: 0 };
  const pageSize = 250;
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  // Use a durable processed marker plus a created_at/id cursor. A fixed newest-N
  // query can permanently starve older events when a busy brand has more than N
  // status changes between cron runs.
  for (;;) {
    let query = svc
      .from("appointment_status_events")
      .select("id, appointment_id, to_status, note, created_at")
      .in("to_status", ["booked", "confirmed", "cancelled"])
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
      const eventId = String(event.id);
      if (String(event.note ?? "") === "rescheduled appointment") {
        await markAppointmentStatusEventProcessed(svc, eventId);
        continue;
      }

      const { data: appointment, error: appointmentError } = await svc
        .from("appointments")
        .select("status, deposit_status, waitlist_entry_id")
        .eq("id", String(event.appointment_id))
        .maybeSingle();
      if (appointmentError) {
        summary.failed += 1;
        continue;
      }
      // A later state transition supersedes this event; it no longer needs a
      // notification, but it must still leave the queue permanently.
      if (String(appointment?.status ?? "") !== String(event.to_status)) {
        await markAppointmentStatusEventProcessed(svc, eventId);
        continue;
      }
      // A waitlist offer creates a capacity-holding appointment before the
      // customer accepts. The waitlist queue owns that notification; sending
      // the ordinary booked message here would falsely claim a confirmed booking.
      if (appointment?.waitlist_entry_id && String(event.to_status) === "booked") {
        await markAppointmentStatusEventProcessed(svc, eventId);
        continue;
      }
      const kind = appointmentNotificationKindForState(
        String(event.to_status),
        String(appointment?.deposit_status ?? "none"),
      );
      if (!kind) {
        await markAppointmentStatusEventProcessed(svc, eventId);
        continue;
      }
      try {
        const result = await notifyAppointmentStatus(svc, String(event.appointment_id), kind);
        summary.sent += result.sent;
        summary.failed += result.failed;
        summary.skipped += result.skipped;
        if (result.failed === 0) await markAppointmentStatusEventProcessed(svc, eventId);
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

async function markAppointmentStatusEventProcessed(svc: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await svc
    .from("appointment_status_events")
    .update({ notification_processed_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("notification_processed_at", null);
  if (error) throw new Error(error.message);
}

async function loadAppointment(svc: SupabaseClient, appointmentId: string): Promise<AppointmentRecord | null> {
  const { data, error } = await svc
    .from("appointments")
    .select("id, clinic_id, patient_id, start_at, end_at, status, deposit_status, deposit_amount, queue_number, clinics(name, line_destination), patients(name, email, line_user_id), doctors(name), services(name)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const rowClinicId = String((data as { clinic_id: string }).clinic_id);
  const { data: settings, error: settingsError } = await svc
    .from("clinic_settings")
    .select("email_enabled")
    .eq("clinic_id", rowClinicId)
    .maybeSingle();
  if (settingsError) throw new Error(settingsError.message);

  const row = data as unknown as {
    id: string;
    clinic_id: string;
    patient_id: string;
    start_at: string;
    end_at: string;
    status: string;
    deposit_status: string;
    deposit_amount: number;
    queue_number: number | null;
    clinics: { name: string; line_destination: string | null } | { name: string; line_destination: string | null }[] | null;
    patients: { name: string; email: string | null; line_user_id: string | null } | { name: string; email: string | null; line_user_id: string | null }[] | null;
    doctors: { name: string } | { name: string }[] | null;
    services: { name: string } | { name: string }[] | null;
  };
  const clinic = first(row.clinics);
  const patient = first(row.patients);
  const doctor = first(row.doctors);
  const service = first(row.services);
  if (!patient || !doctor || !clinic) return null;
  return {
    id: row.id,
    clinic_id: row.clinic_id,
    patient_id: row.patient_id,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status,
    deposit_status: row.deposit_status,
    deposit_amount: Number(row.deposit_amount ?? 0),
    queue_number: row.queue_number,
    clinic_name: clinic.name,
    line_destination: clinic.line_destination,
    patient_name: patient.name,
    patient_email: patient.email,
    patient_line_user_id: patient.line_user_id,
    doctor_name: doctor.name,
    service_name: service?.name ?? null,
    email_enabled: settings?.email_enabled === true,
  };
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function claimNotification(
  svc: SupabaseClient,
  appointment: AppointmentRecord,
  kind: AppointmentNotificationKind,
  channel: "line" | "email",
): Promise<string | null> {
  const { data: inserted, error: insertError } = await svc
    .from("appointment_notification_logs")
    .insert({ clinic_id: appointment.clinic_id, appointment_id: appointment.id, kind, channel, status: "sending", attempt_count: 1 })
    .select("id")
    .maybeSingle();
  if (!insertError && inserted?.id) return String(inserted.id);
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

  const { data: existing, error: existingError } = await svc
    .from("appointment_notification_logs")
    .select("id, status, attempt_count, updated_at")
    .eq("clinic_id", appointment.clinic_id)
    .eq("appointment_id", appointment.id)
    .eq("kind", kind)
    .eq("channel", channel)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing || existing.status === "sent") return null;
  if (existing.status === "sending" && new Date(existing.updated_at).getTime() > Date.now() - 10 * 60 * 1000) return null;

  const { data: claimed, error: claimError } = await svc
    .from("appointment_notification_logs")
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
    .from("appointment_notification_logs")
    .update({ status, error: error ?? null, sent_at: status === "sent" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);
}

async function recordSkippedNotification(
  svc: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  kind: AppointmentNotificationKind,
  channel: "line" | "email",
  reason: string,
): Promise<void> {
  const { error } = await svc
    .from("appointment_notification_logs")
    .insert({ clinic_id: clinicId, appointment_id: appointmentId, kind, channel, status: "skipped", attempt_count: 0, error: reason });
  if (error && error.code !== "23505") throw new Error(error.message);
}

function buildMessage(appointment: AppointmentRecord, kind: AppointmentNotificationKind): { text: string; subject: string; html: string } {
  const labels: Record<AppointmentNotificationKind, string> = {
    pending: "預約待付款",
    confirmed: "預約確認",
    cancelled: "預約已取消",
    rescheduled: "預約已改期",
  };
  const date = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(appointment.start_at));
  const lines = [
    `${appointment.clinic_name}｜${labels[kind]}`,
    `預約人：${appointment.patient_name}`,
    `時間：${date}`,
    `服務提供者：${appointment.doctor_name}`,
    appointment.service_name ? `服務：${appointment.service_name}` : "",
    appointment.queue_number ? `號碼：${appointment.queue_number}` : "",
    appointment.deposit_status === "pending" && appointment.deposit_amount > 0 ? `訂金：${appointment.deposit_amount} 元（待付款）` : "",
  ].filter(Boolean);
  if (kind === "pending") lines.push("請依付款頁完成訂金付款，付款完成後才會正式確認預約。");
  if (kind === "cancelled") lines.push("此預約已取消，若需再次預約請重新選擇可用時段。");
  if (kind === "rescheduled") lines.push("原預約已改為以上時間，請依新時間安排。");
  const text = lines.join("\n");
  const subject = `${appointment.clinic_name}｜${labels[kind]}`;
  const html = `<div style="font-family:sans-serif;line-height:1.8;max-width:560px"><h2>${escapeHtml(subject)}</h2><p>${lines.map(escapeHtml).join("<br>")}</p></div>`;
  return { text, subject, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
