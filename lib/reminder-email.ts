import "server-only";

import { formatDateSession, formatDateTime } from "@/lib/slots";

export interface ReminderEmailAppointment {
  start_at: string;
  queue_number: number | null;
  doctors: { name: string } | null;
  patients: { name: string } | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

export function buildReminderHtml(
  appointment: ReminderEmailAppointment,
  mode: "time" | "number",
  clinicName: string | null,
): string {
  const doctor = escapeHtml(appointment.doctors?.name ?? "服務提供者");
  const patient = escapeHtml(appointment.patients?.name ?? "");
  const when = mode === "time"
    ? formatDateTime(appointment.start_at)
    : `${formatDateSession(appointment.start_at)} 第 ${appointment.queue_number ?? "?"} 號`;
  const displayName = escapeHtml(clinicName?.trim() || "預約與報名平台");
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:16px">
      <h2 style="color:#1d4ed8;margin:0 0 12px">預約提醒</h2>
      <p style="font-size:18px;font-weight:bold;margin:0 0 8px">${when}</p>
      <p style="color:#555;margin:0 0 4px">服務提供者:${doctor}</p>
      ${patient ? `<p style="color:#555;margin:0 0 4px">顧客:${patient}</p>` : ""}
      <p style="color:#888;margin:12px 0 0;font-size:14px">
        無法前來請務必提前取消。累計三次未提前取消而未出席,將暫停一個月線上預約資格。
      </p>
      <p style="color:#aaa;margin:16px 0 0;font-size:12px">${displayName}</p>
    </div>`;
}
