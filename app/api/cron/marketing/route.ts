import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getClinicSettings } from "@/lib/http";
import { lineAccessTokenForDestination, pushMessages } from "@/lib/line";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { formatDateTime } from "@/lib/slots";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AutomationRow {
  id: string;
  name: string;
  trigger_type: "appointment_done" | "birthday" | "inactive";
  segment_id: string | null;
  channel: "line" | "email";
  delay_minutes: number;
  trigger_days: number;
  cooldown_days: number;
  subject: string | null;
  body: string;
  active: boolean;
}

interface PatientRow {
  id: string;
  name: string;
  line_user_id: string | null;
  email: string | null;
  marketing_opt_in: boolean;
  blocked_until: string | null;
  birthday: string | null;
}

interface AppointmentRow {
  id: string;
  patient_id: string;
  start_at: string;
  updated_at: string;
  doctors: { name: string } | null;
}

interface Candidate {
  patient: PatientRow;
  appointment: AppointmentRow | null;
  triggerKey: string;
}

const ID_BATCH_SIZE = 200;
const QUERY_PAGE_SIZE = 1000;

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const svc = createServiceClient();
    const { data: clinics, error: clinicListError } = await svc.from("clinics").select("id").eq("active", true);
    if (clinicListError) throw new Error(clinicListError.message);
    const summary = { scanned: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0, automations: 0 };
    const errors: string[] = [];
    for (const clinic of clinics ?? []) {
      try {
        const result = await runClinic(svc, clinic.id as string);
        summary.scanned += result.scanned;
        summary.sent += result.sent;
        summary.failed += result.failed;
        summary.skipped += result.skipped;
        summary.duplicate += result.duplicate;
        summary.automations += result.automations;
      } catch (error) {
        errors.push(`${clinic.id}: ${error instanceof Error ? error.message : "執行失敗"}`);
      }
    }
    return Response.json({ ok: errors.length === 0, ...summary, errors });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "行銷自動化執行失敗" },
      { status: 500 },
    );
  }
}

async function runClinic(svc: SupabaseClient, clinicId: string): Promise<{ scanned: number; sent: number; failed: number; skipped: number; duplicate: number; automations: number }> {
  const settings = await getClinicSettings(svc, clinicId);
  if (!settings) throw new Error("找不到診所設定");
  const [{ data: automations, error: automationError }, { data: clinic, error: clinicError }] = await Promise.all([
    svc.from("crm_automations").select("id, name, trigger_type, segment_id, channel, delay_minutes, trigger_days, cooldown_days, subject, body, active").eq("clinic_id", clinicId).eq("active", true).order("created_at", { ascending: true }),
    svc.from("clinics").select("name, line_destination").eq("id", clinicId).maybeSingle(),
  ]);
  if (automationError) throw new Error(automationError.message);
  if (clinicError) throw new Error(clinicError.message);
  const rows = (automations ?? []) as unknown as AutomationRow[];
  const summary = { scanned: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  const errors: string[] = [];
  for (const automation of rows) {
    try {
      let lineAccessToken: string | null = null;
      let lineAccessError: string | null = null;
      if (automation.channel === "line") {
        try {
          lineAccessToken = lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
        } catch (error) {
          lineAccessError = error instanceof Error ? error.message : "LINE access token unavailable";
        }
      }
      const result = await runAutomation(
        svc,
        automation,
        settings,
        clinic?.name ?? "",
        summary,
        clinicId,
        lineAccessToken,
        lineAccessError,
      );
      summary.scanned += result.scanned;
    } catch (error) {
      errors.push(`${automation.name}: ${error instanceof Error ? error.message : "執行失敗"}`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return { ...summary, automations: rows.length };
}

async function runAutomation(
  svc: SupabaseClient,
  automation: AutomationRow,
  settings: { email_enabled: boolean },
  clinicName: string,
  summary: { sent: number; failed: number; skipped: number; duplicate: number },
  clinicId: string,
  lineAccessToken: string | null,
  lineAccessError: string | null,
): Promise<{ scanned: number }> {
  const targetIds = await resolveTargetIds(svc, automation.segment_id, clinicId);
  if (targetIds.length === 0) return { scanned: 0 };

  const candidates = await getCandidates(svc, automation, targetIds, clinicId);
  for (const candidate of candidates) {
    if (automation.trigger_type === "inactive") {
      const recent = await hasRecentDelivery(svc, automation, candidate.patient.id, clinicId);
      if (recent) {
        summary.duplicate += 1;
        continue;
      }
    }

    const claim = await claimDelivery(svc, automation, candidate, clinicId);
    if (!claim) {
      summary.duplicate += 1;
      continue;
    }

    const patient = candidate.patient;
    if (!patient.marketing_opt_in) {
      await markDelivery(svc, claim, "skipped", "顧客未同意行銷");
      summary.skipped += 1;
      continue;
    }
    if (patient.blocked_until && new Date(patient.blocked_until).getTime() > Date.now()) {
      await markDelivery(svc, claim, "skipped", "顧客目前被封鎖");
      summary.skipped += 1;
      continue;
    }
    if (automation.channel === "line" && !patient.line_user_id) {
      await markDelivery(svc, claim, "skipped", "顧客沒有 LINE 身分");
      summary.skipped += 1;
      continue;
    }
    if (automation.channel === "line" && !lineAccessToken) {
      await markDelivery(svc, claim, "failed", lineAccessError ?? "LINE access token unavailable");
      summary.failed += 1;
      continue;
    }
    const emailConfig = emailConfigForClinic(clinicId);
    if (automation.channel === "email" && (!patient.email || !settings.email_enabled || !emailConfig)) {
      await markDelivery(svc, claim, "skipped", "顧客或診所尚未完成 Email 設定");
      summary.skipped += 1;
      continue;
    }

    const rendered = renderTemplate(automation.body, patient, candidate.appointment, clinicName);
    try {
      if (automation.channel === "line") {
        await pushMessages(patient.line_user_id!, [{ type: "text", text: rendered }], lineAccessToken!);
      } else {
        const subject = renderTemplate(automation.subject ?? automation.name, patient, candidate.appointment, clinicName);
        await sendEmail(
          emailConfig!,
          patient.email!,
          subject,
          `<div style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(rendered)}</div>`,
        );
      }
      await markDelivery(svc, claim, "sent", null);
      summary.sent += 1;
      await recordCrmInteraction(svc, {
        clinicId,
        patientId: patient.id,
        kind: "campaign",
        channel: automation.channel,
        title: automation.name,
        body: rendered,
        appointmentId: candidate.appointment?.id ?? null,
      }).catch((error: unknown) => console.error("CRM campaign interaction failed", error));
    } catch (error) {
      await markDelivery(svc, claim, "failed", error instanceof Error ? error.message : "投遞失敗");
      summary.failed += 1;
    }
  }
  return { scanned: candidates.length };
}

async function resolveTargetIds(svc: SupabaseClient, segmentId: string | null, clinicId: string): Promise<string[]> {
  if (segmentId) {
    const { error: refreshError } = await svc.rpc("refresh_crm_segment", { p_clinic_id: clinicId, p_segment_id: segmentId });
    if (refreshError) throw new Error(refreshError.message);
    const targetIds: string[] = [];
    for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
      const { data, error } = await svc
        .from("crm_segment_members")
        .select("patient_id")
        .eq("clinic_id", clinicId)
        .eq("segment_id", segmentId)
        .order("patient_id")
        .range(offset, offset + QUERY_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const page = data ?? [];
      targetIds.push(...page.map((row) => row.patient_id as string));
      if (page.length < QUERY_PAGE_SIZE) break;
    }
    return targetIds;
  }

  const targetIds: string[] = [];
  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const { data, error } = await svc
      .from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("id")
      .range(offset, offset + QUERY_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    targetIds.push(...page.map((row) => row.id as string));
    if (page.length < QUERY_PAGE_SIZE) break;
  }
  return targetIds;
}

async function getCandidates(svc: SupabaseClient, automation: AutomationRow, targetIds: string[], clinicId: string): Promise<Candidate[]> {
  const patientRows: PatientRow[] = [];
  for (const patientIds of chunked(targetIds, ID_BATCH_SIZE)) {
    const { data: patients, error: patientError } = await svc
      .from("patients")
      .select("id, name, line_user_id, email, marketing_opt_in, blocked_until, birthday")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .in("id", patientIds);
    if (patientError) throw new Error(patientError.message);
    patientRows.push(...((patients ?? []) as unknown as PatientRow[]));
  }
  const today = taipeiDate(new Date());

  if (automation.trigger_type === "birthday") {
    return patientRows
      .filter((patient) => patient.birthday?.slice(5) === today.slice(5))
      .map((patient) => ({ patient, appointment: null, triggerKey: `birthday:${today}:${patient.id}` }));
  }

  if (automation.trigger_type === "inactive") {
    const inactivityDays = Math.max(1, automation.trigger_days);
    const nowMs = Date.now();
    const since = new Date(nowMs - inactivityDays * 24 * 60 * 60 * 1000).toISOString();
    const appointments: Array<{ id: string; patient_id: string; start_at: string; status: string }> = [];
    for (const patientIds of chunked(targetIds, ID_BATCH_SIZE)) {
      for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
        const { data, error } = await svc
          .from("appointments")
          .select("id, patient_id, start_at, status")
          .eq("clinic_id", clinicId)
          .in("patient_id", patientIds)
          .in("status", ["booked", "confirmed", "done"])
          .gte("start_at", since)
          .order("start_at")
          .order("id")
          .range(offset, offset + QUERY_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as unknown as Array<{ id: string; patient_id: string; start_at: string; status: string }>;
        appointments.push(...page);
        if (page.length < QUERY_PAGE_SIZE) break;
      }
    }
    const recent = new Set<string>();
    const future = new Set<string>();
    for (const row of appointments) {
      const patientId = row.patient_id as string;
      const startAtMs = new Date(row.start_at as string).getTime();
      if ((row.status === "booked" || row.status === "confirmed") && startAtMs >= nowMs) {
        future.add(patientId);
      } else if (row.status === "done") {
        recent.add(patientId);
      }
    }
    return patientRows
      .filter((patient) => !future.has(patient.id) && !recent.has(patient.id))
      .map((patient) => ({ patient, appointment: null, triggerKey: `inactive:${today}:${patient.id}` }));
  }

  const lookbackDays = Math.max(14, Math.ceil(automation.delay_minutes / (24 * 60)) + 2);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const appointments: AppointmentRow[] = [];
  for (const patientIds of chunked(targetIds, ID_BATCH_SIZE)) {
    for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
      const { data, error: appointmentError } = await svc
        .from("appointments")
        .select("id, patient_id, start_at, updated_at, doctors(name)")
        .eq("clinic_id", clinicId)
        .eq("status", "done")
        .gte("updated_at", since)
        .in("patient_id", patientIds)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(offset, offset + QUERY_PAGE_SIZE - 1);
      if (appointmentError) throw new Error(appointmentError.message);
      const page = (data ?? []) as unknown as AppointmentRow[];
      appointments.push(...page);
      if (page.length < QUERY_PAGE_SIZE) break;
    }
  }
  const patientMap = new Map(patientRows.map((patient) => [patient.id, patient]));
  const now = Date.now();
  const candidates: Candidate[] = [];
  for (const appointment of (appointments ?? []) as unknown as AppointmentRow[]) {
    if (now < new Date(appointment.updated_at).getTime() + automation.delay_minutes * 60 * 1000) continue;
    const patient = patientMap.get(appointment.patient_id);
    if (patient) candidates.push({ patient, appointment, triggerKey: `appointment_done:${appointment.id}` });
  }
  return candidates;
}

async function hasRecentDelivery(svc: SupabaseClient, automation: AutomationRow, patientId: string, clinicId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - automation.cooldown_days * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await svc
    .from("crm_delivery_logs")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("automation_id", automation.id)
    .eq("patient_id", patientId)
    .eq("channel", automation.channel)
    .eq("status", "sent")
    .gte("sent_at", cutoff);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

async function claimDelivery(svc: SupabaseClient, automation: AutomationRow, candidate: Candidate, clinicId: string): Promise<string | null> {
  const { data, error } = await svc.rpc("claim_crm_delivery", {
    p_clinic_id: clinicId,
    p_automation_id: automation.id,
    p_patient_id: candidate.patient.id,
    p_trigger_key: candidate.triggerKey,
    p_channel: automation.channel,
    p_appointment_id: candidate.appointment?.id ?? null,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
}

async function markDelivery(
  svc: SupabaseClient,
  id: string,
  status: "sent" | "failed" | "skipped",
  error: string | null,
): Promise<void> {
  const { error: updateError } = await svc
    .from("crm_delivery_logs")
    .update({ status, error, sent_at: status === "sent" ? new Date().toISOString() : null })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);
}

function taipeiDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);
}

function renderTemplate(template: string, patient: PatientRow, appointment: AppointmentRow | null, clinicName: string): string {
  const values: Record<string, string> = {
    customer_name: patient.name,
    appointment_time: appointment ? formatDateTime(appointment.start_at) : "",
    doctor_name: appointment?.doctors?.name ?? "",
    clinic_name: clinicName,
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char] ?? char;
  });
}
