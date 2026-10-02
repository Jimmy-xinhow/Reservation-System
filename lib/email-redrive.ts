import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { appointmentEmailContent, type AppointmentNotificationKind } from "@/lib/appointment-notifications";
import { deliveryError } from "@/lib/delivery-error";
import { emailConfigForClinic, isEmailProviderRejected, sendEmail } from "@/lib/email";
import { getClinicSettings } from "@/lib/http";
import { buildReminderHtml } from "@/lib/reminder-email";

type RedriveResult = "sent" | "rejected" | "aborted" | "uncertain";

interface RedriveEvent {
  id: string;
  clinic_id: string;
  appointment_id: string;
  source: "appointment" | "reminder";
  notification_kind: AppointmentNotificationKind | "reminder";
  notification_log_id: string;
  status: string;
}

async function markEvent(
  svc: SupabaseClient,
  event: RedriveEvent,
  status: "sent" | "rejected" | "aborted" | "uncertain",
): Promise<void> {
  const errorCode = status === "sent" ? null : status === "rejected" ? "provider_rejected" : status === "aborted" ? "preflight_failed" : "delivery_uncertain";
  const { data, error } = await svc.from("email_redrive_events")
    .update({ status, error_code: errorCode, finished_at: new Date().toISOString() })
    .eq("id", event.id).eq("clinic_id", event.clinic_id).eq("status", "delivering")
    .select("id").maybeSingle();
  if (error || !data) throw new Error("補送稽核寫入失敗");
}

async function markLog(
  svc: SupabaseClient,
  event: RedriveEvent,
  status: "sent" | "rejected",
): Promise<void> {
  if (event.source === "appointment") {
    const { data, error } = await svc.from("appointment_notification_logs")
      .update({ status: status === "sent" ? "sent" : "failed", error: status === "sent" ? null : "delivery_error:provider_rejected", sent_at: status === "sent" ? new Date().toISOString() : null })
      .eq("id", event.notification_log_id).eq("clinic_id", event.clinic_id).eq("status", "sending")
      .select("id").maybeSingle();
    if (error || !data) throw new Error("補送狀態寫入失敗");
  } else {
    const { data, error } = await svc.from("reminder_logs")
      .update({ result: status === "sent" ? "sent" : "failed", error: status === "sent" ? null : "delivery_error:provider_rejected", sent_at: new Date().toISOString() })
      .eq("id", event.notification_log_id).eq("clinic_id", event.clinic_id).eq("result", "sending")
      .select("id").maybeSingle();
    if (error || !data) throw new Error("補送狀態寫入失敗");
  }
}

async function reminderContent(svc: SupabaseClient, clinicId: string, appointmentId: string): Promise<{ subject: string; html: string }> {
  const [{ data: appointment, error: appointmentError }, { data: clinic, error: clinicError }, settings] = await Promise.all([
    svc.from("appointments")
      .select("id,start_at,queue_number,doctors(name),patients(name)")
      .eq("id", appointmentId).eq("clinic_id", clinicId).maybeSingle(),
    svc.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
    getClinicSettings(svc, clinicId),
  ]);
  if (appointmentError || clinicError || !appointment || !settings) throw new Error("提醒資料讀取失敗");
  const row = appointment as unknown as {
    start_at: string;
    queue_number: number | null;
    doctors: { name: string } | null;
    patients: { name: string } | null;
  };
  return { subject: "預約提醒", html: buildReminderHtml(row, settings.booking_mode, clinic?.name ?? null) };
}

/** Never retry an uncertain result. A manual claim may only originate from a definite provider 422. */
export async function deliverClaimedEmailRedrive(
  svc: SupabaseClient,
  clinicId: string,
  redriveId: string,
  expectedEmail: string,
): Promise<RedriveResult> {
  const { data, error } = await svc.from("email_redrive_events")
    .select("id,clinic_id,appointment_id,source,notification_kind,notification_log_id,status")
    .eq("id", redriveId).eq("clinic_id", clinicId).maybeSingle();
  if (error || !data) throw new Error("補送紀錄讀取失敗");
  const event = data as RedriveEvent;
  if (event.status !== "claimed") throw new Error("補送已處理，不能重複發送");
  const { data: acquired, error: acquireError } = await svc.from("email_redrive_events")
    .update({ status: "delivering" })
    .eq("id", event.id).eq("clinic_id", clinicId).eq("status", "claimed")
    .select("id").maybeSingle();
  if (acquireError || !acquired) throw new Error("補送已由另一位操作者處理");

  let attempted = false;
  try {
    const [{ data: appointment, error: appointmentError }, config] = await Promise.all([
      svc.from("appointments").select("patient_id,status,deposit_status,start_at,patients(email)")
        .eq("id", event.appointment_id).eq("clinic_id", clinicId).maybeSingle(),
      emailConfigForClinic(clinicId, svc),
    ]);
    const patient = appointment?.patients as unknown as { email: string | null } | null;
    if (appointmentError || !patient?.email || !config || patient.email.toLowerCase() !== expectedEmail) {
      throw new Error("補送收件人或寄件設定已變更");
    }
    const startAt = Date.parse(appointment?.start_at ?? "");
    const active = ["booked", "confirmed"].includes(appointment?.status ?? "");
    const kind = event.notification_kind;
    const applicable = Number.isFinite(startAt) && startAt > Date.now() && (
      event.source === "reminder"
        ? active && startAt <= Date.now() + (Number(process.env.REMINDER_HOURS_BEFORE ?? 24) || 24) * 3600_000
        : kind === "pending" ? appointment?.status === "booked" && appointment?.deposit_status === "pending"
        : kind === "confirmed" ? active && appointment?.deposit_status !== "pending"
        : kind === "cancelled" ? appointment?.status === "cancelled"
        : kind === "rescheduled" && active
    );
    if (!applicable) throw new Error("預約狀態已變更，不再適用補送");
    const content = event.source === "reminder"
      ? await reminderContent(svc, clinicId, event.appointment_id)
      : await appointmentEmailContent(svc, clinicId, event.appointment_id, event.notification_kind as AppointmentNotificationKind);
    attempted = true;
    await sendEmail(config, expectedEmail, content.subject, content.html, { idempotencyKey: `email-redrive-${event.id}` });
    await markLog(svc, event, "sent");
    await markEvent(svc, event, "sent");
    return "sent";
  } catch (caught) {
    if (!attempted) {
      try {
        await markLog(svc, event, "rejected");
        await markEvent(svc, event, "aborted");
        return "aborted";
      } catch (markError) {
        console.error("Email redrive preflight rollback failed", { clinicId, redriveId, category: deliveryError(markError) });
      }
    }
    if (attempted && isEmailProviderRejected(caught)) {
      try {
        await markLog(svc, event, "rejected");
        await markEvent(svc, event, "rejected");
        return "rejected";
      } catch (markError) {
        console.error("Rejected Email redrive acknowledgement failed", { clinicId, redriveId, category: deliveryError(markError) });
      }
    }
    console.error("Email redrive outcome uncertain", { clinicId, redriveId, category: deliveryError(caught) });
    await markEvent(svc, event, "uncertain").catch((markError: unknown) => {
      console.error("Email redrive audit failed", { clinicId, redriveId, category: deliveryError(markError) });
    });
    return "uncertain";
  }
}
