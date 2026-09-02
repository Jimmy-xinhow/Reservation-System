import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { lineAccessTokenForDestination, pushMessages } from "@/lib/line";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { buildWaitlistStatusFlex } from "@/lib/line-ui-templates";
import { customerEntryUrl } from "@/lib/customer-entry";
import { formatDateTime } from "@/lib/slots";

interface ClaimedNotification {
  log_id: string;
  clinic_id: string;
  waitlist_id: string;
  kind: "joined" | "offered" | "booked" | "cancelled" | "expired";
  channel: "line" | "email";
  patient_name: string;
  line_user_id: string | null;
  email: string | null;
  booking_mode: "time" | "number";
  requested_date: string;
  target_start_at: string | null;
  position: number;
  offer_expires_at: string | null;
  appointment_id: string | null;
  doctor_name: string | null;
  service_name: string | null;
  clinic_name: string;
  line_destination: string | null;
  email_enabled: boolean;
}

export interface AppointmentWaitlistNotificationSummary {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function processAppointmentWaitlistNotificationQueue(
  service: SupabaseClient,
  limit = 50,
): Promise<AppointmentWaitlistNotificationSummary> {
  const { data, error } = await service.rpc("claim_appointment_waitlist_notifications", { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClaimedNotification[];
  const summary: AppointmentWaitlistNotificationSummary = { claimed: rows.length, sent: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    try {
      if (row.channel === "line") {
        if (!row.line_user_id) {
          await finish(service, row.log_id, "skipped", "customer has no LINE identity");
          summary.skipped += 1;
          continue;
        }
        const context = await getClinicLineChannelContext(service, row.clinic_id);
        if (!context.enabled) {
          await finish(service, row.log_id, "skipped", "brand LINE channel is disabled");
          summary.skipped += 1;
          continue;
        }
        const token = lineAccessTokenForDestination(row.line_destination ?? undefined);
        const entryUrl = customerEntryUrl("appointments", {
          baseUrl: process.env.APP_URL?.trim() || "http://localhost:3000",
          clinicSlug: context.clinicSlug,
          liffId: context.liffId,
        });
        const when = row.target_start_at ? formatDateTime(row.target_start_at) : row.requested_date;
        const target = [when, row.service_name, row.doctor_name].filter(Boolean).join("・");
        await pushMessages(row.line_user_id, [buildWaitlistStatusFlex({
          kind: row.kind,
          clinicName: row.clinic_name,
          target,
          position: row.position,
          offerDeadline: row.offer_expires_at ? formatDateTime(row.offer_expires_at) : null,
          manageUrl: entryUrl,
        })], token);
      } else {
        if (!row.email) {
          await finish(service, row.log_id, "skipped", "customer has no email");
          summary.skipped += 1;
          continue;
        }
        if (!row.email_enabled) {
          await finish(service, row.log_id, "skipped", "brand email is disabled");
          summary.skipped += 1;
          continue;
        }
        const config = emailConfigForClinic(row.clinic_id);
        if (!config) throw new Error("brand email credentials are unavailable");
        const text = waitlistText(row, null);
        await sendEmail(config, row.email, waitlistSubject(row.kind), `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:20px"><h2>${escapeHtml(waitlistSubject(row.kind))}</h2><p style="white-space:pre-line">${escapeHtml(text)}</p></div>`);
      }
      await finish(service, row.log_id, "sent");
      summary.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "waitlist notification failed";
      console.error("Appointment waitlist notification failed", { logId: row.log_id, clinicId: row.clinic_id, error: message });
      await finish(service, row.log_id, "failed", message).catch(() => undefined);
      summary.failed += 1;
    }
  }
  return summary;
}

async function finish(
  service: SupabaseClient,
  logId: string,
  status: "sent" | "failed" | "skipped",
  error: string | null = null,
): Promise<void> {
  const { error: finishError } = await service.rpc("finish_appointment_waitlist_notification", {
    p_log_id: logId,
    p_status: status,
    p_error: error,
  });
  if (finishError) throw new Error(finishError.message);
}

function waitlistSubject(kind: ClaimedNotification["kind"]): string {
  return ({
    joined: "候補登記完成",
    offered: "候補名額已釋出",
    booked: "候補預約已成立",
    cancelled: "候補已取消",
    expired: "候補名額已逾期",
  } as const)[kind];
}

function waitlistText(row: ClaimedNotification, entryUrl: string | null): string {
  const when = row.target_start_at ? formatDateTime(row.target_start_at) : row.requested_date;
  const target = [when, row.service_name, row.doctor_name].filter(Boolean).join("・");
  const intro = `${row.patient_name} 您好，${waitlistSubject(row.kind)}。`;
  const detail = row.kind === "joined"
    ? `候補順位：第 ${row.position} 位。名額釋出後會再次通知。`
    : row.kind === "offered"
      ? `名額已為您暫時保留至 ${row.offer_expires_at ? formatDateTime(row.offer_expires_at) : "通知所示期限"}，請儘快至「我的預約」接受。`
      : row.kind === "booked"
        ? "您已接受候補名額，預約已建立；如需訂金請在「我的預約」完成付款。"
        : row.kind === "cancelled"
          ? "這筆候補已取消，不會再遞補。"
          : "保留期限已過，系統已將名額提供給下一位；需要時可重新登記候補。";
  return [intro, target, detail, entryUrl].filter(Boolean).join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
