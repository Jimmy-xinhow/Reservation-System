import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "";
const publicDomain = process.env.STAGING_BASE_URL?.trim() ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "https://reservation-system-staging-staging.up.railway.app");
if (!supabaseUrl || !serviceKey || !cronSecret) throw new Error("Missing staging Supabase or CRON environment variables");
if (environmentName.toLowerCase() !== "staging") throw new Error(`Refusing to run outside staging: ${environmentName || "unknown"}`);

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const qaSlug = `qa-notifications-${suffix}`;
let clinicId = null;
let failed = false;

function pass(message) { console.log(`[PASS] ${message}`); }
function fail(message) { failed = true; console.error(`[FAIL] ${message}`); }
function assert(message, condition) { condition ? pass(message) : fail(message); }
async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function cleanupClinic(targetClinicId) {
  if (!targetClinicId) return;
  const errors = [];
  async function remove(label, query) {
    const { error } = await query;
    if (error) errors.push(`${label}: ${error.message}`);
  }
  for (const table of [
    "crm_delivery_logs",
    "crm_segment_members",
    "crm_interactions",
    "crm_automations",
    "crm_segments",
    "registration_notification_logs",
    "registration_status_events",
    "checkins",
    "registration_answers",
    "waitlist_entries",
    "discount_redemptions",
    "payment_transactions",
    "payment_status_events",
    "payment_orders",
    "registrations",
    "registration_form_fields",
    "registration_forms",
    "event_ticket_types",
    "event_sessions",
    "events",
    "appointment_waitlist_notification_logs",
    "appointment_waitlist_events",
    "appointment_notification_logs",
    "appointment_status_events",
    "reminder_logs",
    "appointment_waitlist_entries",
    "appointments",
    "schedule_exceptions",
    "schedule_templates",
    "services",
    "doctors",
    "patient_records",
    "patients",
    "clinic_members",
    "clinic_line_channels",
    "brand_entitlements",
    "clinic_settings",
  ]) await remove(table, service.from(table).delete().eq("clinic_id", targetClinicId));
  await remove("clinic", service.from("clinics").delete().eq("id", targetClinicId));
  if (errors.length) throw new Error(errors.join("; "));
}

async function cron(path, authorized = true) {
  const response = await fetch(new URL(path, publicDomain), {
    headers: authorized ? { Authorization: `Bearer ${cronSecret}` } : {},
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);
}

try {
  const staleClinics = await must("find stale notification QA clinics", service.from("clinics").select("id").like("slug", "qa-notifications-%"));
  for (const staleClinic of staleClinics ?? []) await cleanupClinic(staleClinic.id);
  if ((staleClinics ?? []).length) pass(`Removed ${staleClinics.length} stale notification QA clinic(s)`);

  const clinic = await must("create clinic", service.from("clinics").insert({
    name: "QA Notification Lifecycle",
    slug: qaSlug,
    active: true,
    line_destination: `UQA-${suffix}`,
  }).select("id").single());
  clinicId = clinic.id;
  await must("configure notification features", service.from("clinic_settings").update({
    booking_mode: "time",
    email_enabled: false,
    crm_automation_enabled: true,
  }).eq("clinic_id", clinicId));

  const doctor = await must("create provider", service.from("doctors").insert({
    clinic_id: clinicId, name: "QA Notification Provider", active: true,
  }).select("id").single());
  const serviceRow = await must("create service", service.from("services").insert({
    clinic_id: clinicId, name: "QA Notification Service", active: true,
    booking_target: "provider_required", duration_minutes: 30, buffer_minutes: 0,
  }).select("id").single());
  const today = taipeiDate();
  const birthday = `2000-${today.slice(5)}`;
  const patients = await must("create notification patients", service.from("patients").insert([
    {
      clinic_id: clinicId, name: "QA Reminder", phone: "0911000001",
      line_user_id: `UQA-reminder-${suffix}`, marketing_opt_in: true,
    },
    {
      clinic_id: clinicId, name: "QA Done Opt Out", phone: "0911000002",
      line_user_id: `UQA-optout-${suffix}`, marketing_opt_in: false,
    },
    {
      clinic_id: clinicId, name: "QA Birthday Email", phone: "0911000003",
      email: "qa-birthday@example.invalid", birthday, marketing_opt_in: true,
    },
    {
      clinic_id: clinicId, name: "QA Inactive Blocked", phone: "0911000004",
      line_user_id: `UQA-blocked-${suffix}`, marketing_opt_in: true,
      blocked_until: new Date(Date.now() + 86_400_000).toISOString(),
    },
  ]).select("id,name"));
  const byName = new Map(patients.map((patient) => [patient.name, patient]));

  const reminderStart = new Date(Date.now() + 60 * 60_000);
  const doneStart = new Date(Date.now() - 2 * 86_400_000);
  const appointments = await must("create reminder and completed appointments", service.from("appointments").insert([
    {
      clinic_id: clinicId, doctor_id: doctor.id, patient_id: byName.get("QA Reminder").id,
      service_id: serviceRow.id, start_at: reminderStart.toISOString(),
      end_at: new Date(reminderStart.getTime() + 30 * 60_000).toISOString(), status: "booked",
    },
    {
      clinic_id: clinicId, doctor_id: doctor.id, patient_id: byName.get("QA Done Opt Out").id,
      service_id: serviceRow.id, start_at: doneStart.toISOString(),
      end_at: new Date(doneStart.getTime() + 30 * 60_000).toISOString(), status: "done",
    },
  ]).select("id,status"));
  const reminderAppointment = appointments.find((row) => row.status === "booked");
  const doneAppointment = appointments.find((row) => row.status === "done");

  const eventStart = new Date(Date.now() + 2 * 86_400_000);
  const event = await must("create notification event", service.from("events").insert({
    clinic_id: clinicId,
    slug: `qa-notify-event-${suffix}`,
    title: "QA Notification Event",
    status: "published",
    access_mode: "public",
    registration_open_at: new Date(Date.now() - 60_000).toISOString(),
    registration_close_at: new Date(Date.now() + 86_400_000).toISOString(),
  }).select("id").single());
  const eventSession = await must("create notification event session", service.from("event_sessions").insert({
    clinic_id: clinicId,
    event_id: event.id,
    name: "QA Notification Session",
    start_at: eventStart.toISOString(),
    end_at: new Date(eventStart.getTime() + 60 * 60_000).toISOString(),
    capacity: 5,
    waitlist_enabled: true,
  }).select("id").single());
  const registration = await must("create confirmed registration", service.from("registrations").insert({
    clinic_id: clinicId,
    patient_id: byName.get("QA Done Opt Out").id,
    event_id: event.id,
    session_id: eventSession.id,
    registration_no: `REG-QA-${suffix}`,
    status: "confirmed",
    payment_status: "not_required",
    amount: 0,
    name: "QA Done Opt Out",
    phone: "0911000002",
    line_user_id: `UQA-registration-${suffix}`,
    marketing_opt_in: false,
    answers: {},
    checkin_token_hash: randomBytes(32).toString("hex"),
  }).select("id").single());

  const automations = await must("create all three CRM automations", service.from("crm_automations").insert([
    {
      clinic_id: clinicId, name: "QA Appointment Done", trigger_type: "appointment_done", channel: "line",
      delay_minutes: 0, trigger_days: 30, cooldown_days: 30, body: "Hello {{customer_name}}", active: true,
    },
    {
      clinic_id: clinicId, name: "QA Birthday", trigger_type: "birthday", channel: "email",
      delay_minutes: 0, trigger_days: 1, cooldown_days: 30, subject: "Birthday", body: "Happy birthday {{customer_name}}", active: true,
    },
    {
      clinic_id: clinicId, name: "QA Inactive", trigger_type: "inactive", channel: "line",
      delay_minutes: 0, trigger_days: 1, cooldown_days: 30, body: "We miss you {{customer_name}}", active: true,
    },
  ]).select("id,trigger_type"));
  assert("appointment_done, birthday and inactive automations exist", new Set(automations.map((row) => row.trigger_type)).size === 3);

  const unauthorizedReminder = await cron("/api/cron/reminders", false);
  const unauthorizedMarketing = await cron("/api/cron/marketing", false);
  assert("reminder and marketing cron reject missing authorization", unauthorizedReminder.status === 401 && unauthorizedMarketing.status === 401);

  const hours = Number(process.env.REMINDER_HOURS_BEFORE ?? 24) || 24;
  const otherReminderRows = await must("check other reminder candidates", service.from("appointments")
    .select("id,clinic_id")
    .neq("clinic_id", clinicId)
    .in("status", ["booked", "confirmed"])
    .gt("start_at", new Date().toISOString())
    .lte("start_at", new Date(Date.now() + hours * 3600_000).toISOString()));
  if (otherReminderRows.length) throw new Error(`Unsafe reminder precondition: ${otherReminderRows.length} non-QA appointment(s) are inside the reminder window`);

  const tokenMapConfigured = Boolean(process.env.LINE_CHANNEL_ACCESS_TOKENS_JSON?.trim());
  const fallbackTokenConfigured = Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim());
  if (fallbackTokenConfigured && !tokenMapConfigured) {
    throw new Error("Unsafe reminder precondition: a shared LINE token could send to the fake QA user");
  }
  const firstReminder = await cron("/api/cron/reminders");
  assert("same-day appointment is scanned and missing brand LINE credentials fail closed", firstReminder.status === 200 && firstReminder.body?.scanned === 1 && firstReminder.body?.lineFailed === 1 && firstReminder.body?.line === 0);
  const firstReminderLogs = await must("read first reminder log", service.from("reminder_logs")
    .select("id,result,error").eq("appointment_id", reminderAppointment.id).eq("channel", "line"));
  assert("failed reminder is auditable in one tenant-scoped row", firstReminderLogs.length === 1 && firstReminderLogs[0].result === "failed" && Boolean(firstReminderLogs[0].error));

  const secondReminder = await cron("/api/cron/reminders");
  const secondReminderLogs = await must("read retried reminder log", service.from("reminder_logs")
    .select("id,result").eq("appointment_id", reminderAppointment.id).eq("channel", "line"));
  assert("failed reminder retries without creating a duplicate row", secondReminder.status === 200 && secondReminder.body?.lineFailed === 1 && secondReminderLogs.length === 1 && secondReminderLogs[0].id === firstReminderLogs[0].id);
  await must("simulate successful reminder completion", service.from("reminder_logs")
    .update({ result: "sent", error: null, sent_at: new Date().toISOString() }).eq("id", firstReminderLogs[0].id));
  const thirdReminder = await cron("/api/cron/reminders");
  const finalReminderLogs = await must("read final reminder log", service.from("reminder_logs")
    .select("id,result").eq("appointment_id", reminderAppointment.id).eq("channel", "line"));
  assert("sent reminder is never claimed again", thirdReminder.status === 200 && thirdReminder.body?.lineFailed === 0 && finalReminderLogs.length === 1 && finalReminderLogs[0].result === "sent");

  const otherAutomations = await must("check other active automations", service.from("crm_automations")
    .select("id,clinic_id").neq("clinic_id", clinicId).eq("active", true));
  if (otherAutomations.length) throw new Error(`Unsafe marketing precondition: ${otherAutomations.length} non-QA active automation(s) exist`);

  const firstMarketing = await cron("/api/cron/marketing");
  console.log(`[INFO] first marketing summary: ${JSON.stringify(firstMarketing.body)}`);
  assert("three CRM trigger types run without external delivery", firstMarketing.status === 200 && firstMarketing.body?.automations === 3 && firstMarketing.body?.scanned === 5 && firstMarketing.body?.skipped === 5 && firstMarketing.body?.sent === 0 && firstMarketing.body?.failed === 0);
  const deliveryLogs = await must("read CRM delivery logs", service.from("crm_delivery_logs")
    .select("id,patient_id,trigger_key,channel,status,error,attempt_count").eq("clinic_id", clinicId));
  assert("opt-out, missing Email setup, missing LINE identity and blocked customer are skipped with reasons", deliveryLogs.length === 5 && deliveryLogs.every((row) => row.status === "skipped" && row.attempt_count === 1 && Boolean(row.error)) &&
    deliveryLogs.some((row) => row.error.includes("未同意行銷")) &&
    deliveryLogs.some((row) => row.error.includes("Email 設定")) &&
    deliveryLogs.some((row) => row.error.includes("沒有 LINE 身分")) &&
    deliveryLogs.some((row) => row.error.includes("被封鎖")));

  const secondMarketing = await cron("/api/cron/marketing");
  console.log(`[INFO] second marketing summary: ${JSON.stringify(secondMarketing.body)}`);
  const deliveryLogsAfterRetry = await must("read deduplicated CRM delivery logs", service.from("crm_delivery_logs")
    .select("id,attempt_count").eq("clinic_id", clinicId));
  assert("second marketing cron deduplicates every trigger and channel", secondMarketing.status === 200 && secondMarketing.body?.duplicate === 5 && deliveryLogsAfterRetry.length === 5 && deliveryLogsAfterRetry.every((row) => row.attempt_count === 1));

  const retryAutomation = automations.find((row) => row.trigger_type === "appointment_done");
  const retryLog = deliveryLogs.find((row) => row.trigger_key === `appointment_done:${doneAppointment.id}`);
  await must("prepare failed CRM retry", service.from("crm_delivery_logs").update({
    status: "failed",
    error: "simulated provider failure",
    attempted_at: new Date(Date.now() - 11 * 60_000).toISOString(),
  }).eq("id", retryLog.id));
  const reclaimed = await must("reclaim failed CRM delivery", service.rpc("claim_crm_delivery", {
    p_clinic_id: clinicId,
    p_automation_id: retryAutomation.id,
    p_patient_id: byName.get("QA Done Opt Out").id,
    p_trigger_key: `appointment_done:${doneAppointment.id}`,
    p_channel: "line",
    p_appointment_id: doneAppointment.id,
  }));
  const reclaimedLog = await must("read reclaimed CRM delivery", service.from("crm_delivery_logs")
    .select("id,status,attempt_count,error").eq("id", retryLog.id).single());
  assert("failed CRM delivery becomes retryable after ten minutes", reclaimed === retryLog.id && reclaimedLog.status === "pending" && reclaimedLog.attempt_count === 2 && reclaimedLog.error === null);

  const [otherAppointmentEvents, otherRegistrationEvents] = await Promise.all([
    must("check other appointment notification events", service.from("appointment_status_events")
      .select("id,clinic_id").neq("clinic_id", clinicId).is("notification_processed_at", null)
      .in("to_status", ["booked", "confirmed", "cancelled"])),
    must("check other registration notification events", service.from("registration_status_events")
      .select("id,clinic_id").neq("clinic_id", clinicId).is("notification_processed_at", null)
      .in("to_status", ["pending", "confirmed", "waitlisted", "cancelled"])),
  ]);
  if (otherAppointmentEvents.length || otherRegistrationEvents.length) {
    throw new Error(`Unsafe notification precondition: ${otherAppointmentEvents.length} appointment and ${otherRegistrationEvents.length} registration event(s) belong to other clinics`);
  }

  const firstQueue = await cron("/api/cron/registration");
  console.log(`[INFO] first registration queue summary: ${JSON.stringify(firstQueue.body)}`);
  assert("appointment and registration queues fail LINE closed while independently recording Email skips", firstQueue.status === 200 &&
    firstQueue.body?.appointment_notifications?.failed === 1 && firstQueue.body?.appointment_notifications?.skipped === 1 &&
    firstQueue.body?.notifications?.failed === 1 && firstQueue.body?.notifications?.skipped === 1);
  const appointmentNotificationLogs = await must("read appointment notification logs", service.from("appointment_notification_logs")
    .select("id,channel,status,attempt_count,error").eq("appointment_id", reminderAppointment.id));
  const registrationNotificationLogs = await must("read registration notification logs", service.from("registration_notification_logs")
    .select("id,channel,status,attempt_count,error").eq("registration_id", registration.id));
  assert("notification channels have one auditable row each", appointmentNotificationLogs.length === 2 && registrationNotificationLogs.length === 2 &&
    [...appointmentNotificationLogs, ...registrationNotificationLogs].every((row) => Boolean(row.error)) &&
    appointmentNotificationLogs.some((row) => row.channel === "line" && row.status === "failed" && row.attempt_count === 1) &&
    appointmentNotificationLogs.some((row) => row.channel === "email" && row.status === "skipped" && row.attempt_count === 0) &&
    registrationNotificationLogs.some((row) => row.channel === "line" && row.status === "failed" && row.attempt_count === 1) &&
    registrationNotificationLogs.some((row) => row.channel === "email" && row.status === "skipped" && row.attempt_count === 0));

  const secondQueue = await cron("/api/cron/registration");
  const appointmentLogsAfterRetry = await must("read retried appointment notifications", service.from("appointment_notification_logs")
    .select("id,channel,status,attempt_count").eq("appointment_id", reminderAppointment.id));
  const registrationLogsAfterRetry = await must("read retried registration notifications", service.from("registration_notification_logs")
    .select("id,channel,status,attempt_count").eq("registration_id", registration.id));
  assert("notification queue retries failed LINE without duplicate channel rows", secondQueue.status === 200 &&
    appointmentLogsAfterRetry.length === 2 && registrationLogsAfterRetry.length === 2 &&
    appointmentLogsAfterRetry.find((row) => row.channel === "line")?.attempt_count === 2 &&
    registrationLogsAfterRetry.find((row) => row.channel === "line")?.attempt_count === 2);

  await must("simulate delivered appointment LINE notification", service.from("appointment_notification_logs")
    .update({ status: "sent", error: null, sent_at: new Date().toISOString() })
    .eq("appointment_id", reminderAppointment.id).eq("channel", "line"));
  await must("simulate delivered registration LINE notification", service.from("registration_notification_logs")
    .update({ status: "sent", error: null, sent_at: new Date().toISOString() })
    .eq("registration_id", registration.id).eq("channel", "line"));
  const thirdQueue = await cron("/api/cron/registration");
  const appointmentEvent = await must("read completed appointment event", service.from("appointment_status_events")
    .select("notification_processed_at").eq("appointment_id", reminderAppointment.id).eq("to_status", "booked").single());
  const registrationEvent = await must("read completed registration event", service.from("registration_status_events")
    .select("notification_processed_at").eq("registration_id", registration.id).eq("to_status", "confirmed").single());
  assert("notification event cursor completes only after every channel has no failure", thirdQueue.status === 200 && Boolean(appointmentEvent.notification_processed_at) && Boolean(registrationEvent.notification_processed_at));

  console.log(`[INFO] external capabilities: LINE map=${tokenMapConfigured}, shared LINE=${fallbackTokenConfigured}, Email=${Boolean(process.env.RESEND_API_KEY?.trim() || process.env.RESEND_API_KEYS_JSON?.trim())}, payment=${Boolean(process.env.PAYMENT_SECRETS_JSON?.trim())}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try { await cleanupClinic(clinicId); pass("Temporary notification data cleaned"); }
  catch (error) { fail(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
}

if (failed) process.exit(1);
console.log("Staging notification and automation audit passed.");
