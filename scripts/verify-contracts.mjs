import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const schema = read("supabase/schema.sql");
const migrationRegistration = read("supabase/migration_registration_payments.sql");
const migrationHardening = read("supabase/migration_v3_hardening.sql");
const migrationBenefits = read("supabase/migration_memberships_coupons.sql");
const migrationRoleMatrix = read("supabase/migration_role_matrix_v4.sql");

const checks = [
  ["registration payment migration has core tables", ["create table if not exists events", "create table if not exists registrations", "create table if not exists payment_orders"]],
  ["registration answer snapshot is in consolidated schema", ["create table if not exists registration_answers", "insert into registration_answers"]],
  ["status and notification audit tables are in consolidated schema", ["create table if not exists appointment_status_events", "create table if not exists appointment_notification_logs", "create table if not exists registration_status_events", "create table if not exists registration_notification_logs", "create table if not exists payment_status_events"]],
  ["hardening trigger and queue functions are in consolidated schema", ["record_appointment_status_event", "record_registration_status_event", "promote_waitlist_for_session", "expire_registration_payments"]],
  ["dynamic RLS includes new tenant tables", ["registration_answers", "appointment_status_events", "appointment_notification_logs", "registration_notification_logs", "payment_status_events"]],
  ["server-only secret boundaries exist", ["lib/email.ts|import \"server-only\"", "lib/payment.ts|import \"server-only\"", "lib/registration-notifications.ts|import \"server-only\"", "lib/appointment-notifications.ts|import \"server-only\"", "lib/browser-booking.ts|import \"server-only\""]],
  ["public tenant resolver is present", ["lib/public-brand.ts|resolvePublicClinicId"]],
  ["public and fallback routes exist", ["app/register/page.tsx", "app/book/browser/page.tsx", "app/book/browser/my/page.tsx", "app/book/browser/reschedule/page.tsx", "app/book/reschedule/page.tsx", "app/api/booking/browser/start/route.ts", "app/api/booking/browser/my/route.ts", "app/api/booking/reschedule/route.ts", "app/embed/register/page.tsx"]],
  ["admin SaaS modules exist", ["app/admin/crm/page.tsx", "app/admin/reports/page.tsx", "app/admin/registrations/page.tsx", "app/admin/checkin/page.tsx"]],
];

const failures = [];
for (const [label, snippets] of checks) {
  const ok = snippets.every((snippet) => {
    if (snippet.includes("/")) {
      const [file, ...needleParts] = snippet.split("|");
      const needle = needleParts.join("|");
      return exists(file) && (!needle || read(file).includes(needle));
    }
    return schema.includes(snippet) || migrationRegistration.includes(snippet) || migrationHardening.includes(snippet) || migrationBenefits.includes(snippet);
  });
  if (ok) console.log(`[PASS] ${label}`);
  else failures.push(label);
}

const literalPlusLines = schema.split(/\r?\n/).filter((line) => /^\+/.test(line));
if (literalPlusLines.length === 0) console.log("[PASS] schema has no literal patch-marker lines");
else failures.push("schema has no literal patch-marker lines");

const migrationTokens = [
  "appointment_status_events",
  "appointment_notification_logs",
  "registration_notification_logs",
  "payment_status_events",
  "promote_waitlist_for_session",
  "expire_registration_payments",
];
const migrationTokensPresent = migrationTokens.every((token) => migrationHardening.includes(token) && schema.includes(token));
if (migrationTokensPresent) console.log("[PASS] hardening migration tokens are represented in consolidated schema");
else failures.push("hardening migration tokens are represented in consolidated schema");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex < 0 ? source.length : endIndex);
}

function invariant(label, condition) {
  if (condition) console.log(`[PASS] ${label}`);
  else failures.push(label);
}

const tenantTables = [
  "chat_messages", "chat_blocks", "crm_segments", "crm_segment_members", "crm_interactions", "crm_automations", "crm_delivery_logs",
  "clinic_domains", "events", "event_sessions", "event_ticket_types", "registration_forms", "registration_form_fields", "registrations",
  "registration_answers", "waitlist_entries", "checkins", "payment_orders", "payment_transactions", "payment_webhook_events",
  "clinic_payment_settings", "appointment_status_events", "appointment_notification_logs", "registration_status_events",
  "registration_notification_logs", "payment_status_events", "membership_plans", "patient_memberships", "membership_ledger",
  "discount_codes", "discount_redemptions", "reminder_logs", "line_messages", "line_auto_replies", "line_richmenu",
];
const dynamicRlsTableText = [...schema.matchAll(/foreach tbl in array array\[(.*?)\]\s*loop/gs)]
  .map((match) => match[1])
  .join("\n");
invariant(
  "all consolidated tenant tables have dynamic RLS coverage",
  schema.includes("alter table public.%I enable row level security") &&
    tenantTables.every((table) => dynamicRlsTableText.includes(`'${table}'`)),
);
const tableDefinitions = [...schema.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+([a-z0-9_]+)\s*\((.*?)\);/gis)];
invariant(
  "all business tables carry clinic_id",
  tableDefinitions.every((match) => match[1] === "clinics" || /\bclinic_id\b/i.test(match[2])),
);

const timeBooking = between(schema, "create or replace function book_time_slot", "create or replace function get_available_sessions");
const numberBooking = between(schema, "create or replace function book_number", "-- 後台 authenticated 只能存取自己診所");
const registrationFunction = between(schema, "create or replace function register_for_event", "create or replace function checkin_registration");
const registrationApi = read("app/api/registration/register/route.ts");
const registrationEventsApi = read("app/api/registration/events/route.ts");
const bookingReserveApi = read("app/api/booking/reserve/route.ts");
const registrationDetailApi = read("app/api/registration/events/[id]/route.ts");
const registrationAdminApi = read("app/api/admin/registrations/route.ts");
const registrationAdminActions = read("app/admin/registrations/actions.ts");
const marketingCron = read("app/api/cron/marketing/route.ts");
const remindersCron = read("app/api/cron/reminders/route.ts");
const paymentCreateApi = read("app/api/payment/create/route.ts");
const paymentReturnApi = read("app/api/payment/return/route.ts");
const paymentStatusApi = read("app/api/payment/status/route.ts");
const paymentResultPage = read("app/payment/result/page.tsx");
const paymentEcpayApi = read("app/api/payment/ecpay/notify/route.ts");
const paymentNewebpayApi = read("app/api/payment/newebpay/notify/route.ts");
const paymentWebhook = read("lib/payment-webhook.ts");
const appointmentNotifications = read("lib/appointment-notifications.ts");
const registrationNotifications = read("lib/registration-notifications.ts");
const adminActions = read("app/admin/actions.ts");
const settingsPage = read("app/admin/settings/page.tsx");
const browserStartApi = read("app/api/booking/browser/start/route.ts");
const bookingRescheduleApi = read("app/api/booking/reschedule/route.ts");
const browserMyApi = read("app/api/booking/browser/my/route.ts");
const bookingPage = read("app/book/page.tsx");
const reschedulePage = read("app/book/reschedule/page.tsx");
const browserBookingPage = read("app/book/browser/page.tsx");
const browserMyPage = read("app/book/browser/my/page.tsx");
const browserReschedulePage = read("app/book/browser/reschedule/page.tsx");
const bookingConfigApi = read("app/api/booking/config/route.ts");
const rootLayout = read("app/layout.tsx");
const brandComponent = read("components/Brand.tsx");
const reminderCron = read("app/api/cron/reminders/route.ts");
const lineWebhook = read("app/api/line/webhook/route.ts");
const bookingPageSource = read("app/book/page.tsx");
const publicBrand = read("lib/public-brand.ts");
const homePage = read("app/page.tsx");
const registrationPage = read("app/register/page.tsx");
const publicPatientFunction = between(schema, "create or replace function create_or_get_public_patient", "revoke all on function create_or_get_public_patient");

invariant(
  "time booking has concurrency lock and rejects overlapping templates",
  timeBooking.includes("pg_advisory_xact_lock") && timeBooking.includes("v_match_count > 1") && !timeBooking.includes("limit 1"),
);
invariant(
  "first-visit availability and booking use configured duration and stay within the segment",
  timeBooking.includes("p_visit_type not in ('first', 'return')") &&
    timeBooking.includes("first_visit_extends") &&
    timeBooking.includes("v_end > ((v_date + s.end_time) at time zone 'Asia/Taipei')") &&
    migrationHardening.includes("v_end > ((v_date + s.end_time) at time zone 'Asia/Taipei')") &&
    read("app/api/booking/availability/route.ts").includes("p_visit_type: visitType") &&
    read("app/book/page.tsx").includes("visit_type=${visitType}") &&
    read("app/book/browser/page.tsx").includes("setVisitType(\"first\")"),
);
invariant(
  "public booking date bounds use Asia/Taipei",
  read("app/book/page.tsx").includes('timeZone: "Asia/Taipei"') &&
    read("app/book/browser/page.tsx").includes('timeZone: "Asia/Taipei"'),
);
invariant(
  "multi-brand LINE credentials fail closed",
    read("lib/line.ts").includes("function credentialMapsConfigured()") &&
    read("lib/line.ts").includes("if (!destination) throw new Error(\"LINE destination 必須對應品牌 access token\")") &&
    read("lib/line.ts").includes("return destination ? map[destination] ?? \"\" : \"\";") &&
    read("lib/line.ts").includes("secretOverride === undefined ? process.env.LINE_CHANNEL_SECRET : secretOverride") &&
    read("app/admin/actions.ts").includes("getClinicLineContext") &&
    read("app/admin/actions.ts").includes("clinicSlug") &&
    read("app/api/line/webhook/route.ts").includes("liffUrl(clinicSlug)") &&
    read("app/page.tsx").includes("clinic_slug=${encodeURIComponent(clinicSlug)}") &&
    read("app/api/admin/richmenu-image/route.ts").includes("lineAccessTokenForDestination"),
);
invariant(
  "number booking has concurrency lock and capacity guard",
  numberBooking.includes("pg_advisory_xact_lock") && numberBooking.includes("if v_used >= v_cap"),
);
invariant(
  "booking service binding is tenant-validated and failures do not leave active appointments",
  bookingReserveApi.includes('.eq("clinic_id", clinicId)') &&
    bookingReserveApi.includes('.eq("active", true)') &&
    bookingReserveApi.includes('const metadataPatch: { source: "online"; service_id?: string }') &&
    bookingReserveApi.includes('if (selectedServiceId) metadataPatch.service_id = selectedServiceId') &&
    bookingReserveApi.includes('rpc("cancel_appointment"') &&
    adminActions.includes('.eq("clinic_id", opts.clinicId)') &&
    adminActions.includes('rpc("cancel_appointment"'),
);
invariant(
  "registration has concurrency lock and answer snapshot",
  registrationFunction.includes("pg_advisory_xact_lock") && registrationFunction.includes("insert into registration_answers"),
);
invariant(
  "reminder and CRM delivery de-duplication constraints exist",
  schema.includes("clinic_id uuid not null references clinics(id) on delete cascade") &&
    schema.includes("unique (appointment_id, channel)") &&
    schema.includes("unique (automation_id, patient_id, trigger_key, channel)") &&
    schema.includes("drop policy if exists reminder_logs_member on reminder_logs"),
);
invariant(
  "payment webhook replay key is unique and processed idempotently",
  schema.includes("unique (payment_order_id, event_key)") &&
    schema.includes("currency text not null default 'TWD'") &&
    schema.includes("payment_orders_registration_pending_idx") &&
    schema.includes("payment_orders_appointment_pending_idx") &&
    schema.includes("provider_event_key") &&
    paymentWebhook.includes("provider_event_key") &&
    schema.includes("clinic_payment_provider_merchant_idx"),
);
invariant(
  "payment webhook cannot downgrade a terminal order and only notifies on a real transition",
  paymentWebhook.includes('if (order.status !== "pending")') &&
    paymentWebhook.includes('eq("status", "pending")') &&
    paymentWebhook.includes("changed: true") &&
    paymentEcpayApi.includes("result.changed") &&
    paymentNewebpayApi.includes("result.changed"),
);
invariant(
  "payment webhook retries reconcile downstream registration state",
  paymentWebhook.includes("duplicateEvent") &&
    paymentWebhook.includes("reconcilePaymentState") &&
    paymentWebhook.includes("order.status === \"paid\" && event.success") &&
    paymentWebhook.includes("if (updatedRegistration)"),
);
invariant(
  "appointment lifecycle notifications have idempotent LINE and email delivery",
  schema.includes("create table if not exists appointment_notification_logs") &&
    migrationHardening.includes("create table if not exists appointment_notification_logs") &&
    appointmentNotifications.includes("APPOINTMENT_NOTIFICATION_KINDS") &&
    appointmentNotifications.includes("lineAccessTokenForDestination") &&
    appointmentNotifications.includes("emailConfigForClinic") &&
    appointmentNotifications.includes('.from("clinic_settings")') &&
    schema.includes("unique (appointment_id, kind, channel)") &&
    read("app/api/booking/reserve/route.ts").includes("notifyAppointmentStatus") &&
    read("app/api/booking/cancel/route.ts").includes("notifyAppointmentStatus") &&
    adminActions.includes("notifyAppointmentStatus") &&
    read("app/api/line/webhook/route.ts").includes("notifyAppointmentStatus") &&
    paymentEcpayApi.includes("appointment_id") &&
    paymentNewebpayApi.includes("appointment_id") &&
    paymentReturnApi.includes("notifyAppointmentForPayment") &&
    read("app/api/cron/registration/route.ts").includes("processAppointmentNotificationQueue"),
);
invariant(
  "registration notification retries use optimistic concurrency",
  registrationNotifications.includes('.eq("updated_at", existing.updated_at)') &&
    schema.includes("unique (registration_id, kind, channel)"),
);
invariant(
  "notification skips are recorded for both channels",
  schema.includes("status in ('sending','sent','failed','skipped')") &&
    migrationHardening.includes("status in ('sending','sent','failed','skipped')") &&
    appointmentNotifications.includes("recordSkippedNotification") &&
    registrationNotifications.includes("recordSkippedNotification") &&
    appointmentNotifications.includes('status: "skipped"') &&
    registrationNotifications.includes('status: "skipped"'),
);
invariant(
  "deposit payments have a public flow and expiry release path",
  read("app/api/payment/create/route.ts").includes("verifyBrowserBookingToken") &&
    read("app/api/payment/create/route.ts").includes("verifyLiffIdToken") &&
    schema.includes("deposit_expires_at") &&
    schema.includes("expire_pending_appointment_deposits") &&
    read("app/api/cron/registration/route.ts").includes("expire_pending_appointment_deposits"),
);
invariant(
  "public payment return paths stay on the branded flow",
  paymentCreateApi.includes("safeReturnPath") &&
    paymentCreateApi.includes("return_path") &&
    read("app/book/page.tsx").includes("window.location.pathname + window.location.search") &&
    read("app/book/browser/page.tsx").includes("window.location.pathname + window.location.search") &&
    read("app/register/page.tsx").includes("window.location.pathname + window.location.search"),
);
invariant(
  "payment browser return preserves status and branded context",
  schema.includes("return_path text not null default '/'" ) &&
    migrationRegistration.includes("alter table payment_orders add column if not exists return_path") &&
    paymentCreateApi.includes("/api/payment/return") &&
    paymentCreateApi.includes("existingOrder.provider !== settings.provider") &&
    paymentReturnApi.includes("processPaymentWebhook") &&
    paymentReturnApi.includes("notifyRegistrationForPayment") &&
    paymentStatusApi.includes('.eq("clinic_id", clinicId)') &&
    paymentStatusApi.includes("rateLimitResponse") &&
    paymentResultPage.includes("/api/payment/status") &&
    read("app/register/page.tsx").includes("localStorage.setItem(`registration:")
);
invariant(
  "public cancellation and payment creation are rate limited",
  read("app/api/booking/cancel/route.ts").includes('checkRateLimit(req, "booking:cancel"') &&
    bookingRescheduleApi.includes('checkRateLimit(req, "booking:reschedule"') &&
    browserMyApi.includes('rateLimitResponse(req, "booking:browser-my"') &&
    paymentCreateApi.includes('checkRateLimit(req, "payment:create"'),
);
invariant(
  "customer appointment reschedule is available from LINE and browser fallback",
  bookingRescheduleApi.includes('verifyLiffIdToken') &&
    bookingRescheduleApi.includes('verifyBrowserBookingToken') &&
    bookingRescheduleApi.includes('rpc("reschedule_appointment"') &&
    bookingRescheduleApi.includes('notifyAppointmentStatus') &&
    bookingRescheduleApi.includes('recordCrmInteraction') &&
    bookingPage.includes("openReschedule") &&
    reschedulePage.includes('/api/booking/reschedule') &&
    reschedulePage.includes('/api/payment/create') &&
    reschedulePage.includes('!url.startsWith("/api/payment/create")') &&
    browserBookingPage.includes('localStorage.setItem(browserTokenKey()') &&
    browserBookingPage.includes('const clinicId = source.get("clinic_id")?.trim()') &&
    browserMyPage.includes('/api/booking/browser/my') &&
    browserMyPage.includes('/book/browser/reschedule') &&
    browserReschedulePage.includes('browser_token: token'),
);
invariant(
  "public brand identity is not hardcoded to the legacy clinic",
  bookingConfigApi.includes('select("name")') &&
    bookingConfigApi.includes("clinic_name") &&
    brandComponent.includes("name?: string | null") &&
    bookingPageSource.includes("clinicName={config.clinic_name}") &&
    reminderCron.includes('select("name, line_destination")') &&
    lineWebhook.includes("clinicName") &&
    publicBrand.includes("const clinicId = scope.clinicId?.trim()") &&
    publicBrand.includes("const hostClinicId") &&
    publicBrand.includes('.not("verified_at", "is", null)') &&
    publicBrand.includes("slugClinic?.id !== hostClinicId") &&
    publicBrand.includes("clinicId !== configuredClinicId") &&
    publicBrand.includes("slug && clinicId && slugClinic?.id !== idClinic?.id") &&
    homePage.includes("const clinicScopeSuffix") &&
    registrationPage.includes("requestedClinicId") &&
    registrationPage.includes("clinicId={clinicId}") &&
    rootLayout.includes("預約與報名平台") &&
    ![rootLayout, reminderCron, lineWebhook, bookingPageSource, brandComponent].some((source) => source.includes("慈愛中醫診所")),
);
invariant(
  "public patient identity is birthday-bound and concurrency-safe",
  browserStartApi.includes("create_or_get_public_patient") &&
    browserStartApi.includes("p_birthday: birthday") &&
    publicPatientFunction.includes("pg_advisory_xact_lock") &&
    publicPatientFunction.includes("birthday is not distinct from p_birthday") &&
    publicPatientFunction.includes("max_patients_per_phone"),
);
invariant(
  "number availability excludes full sessions",
  schema.includes("having count(a.id) < x.capacity") && migrationHardening.includes("having count(a.id) < x.capacity"),
);
invariant(
  "number mode blocks overlapping partial closures in availability and booking",
  schema.includes("coalesce(e.end_time, '23:59:59.999999'::time) > t.start_time") &&
    schema.includes("ec.start_time < v_end") &&
    migrationHardening.includes("coalesce(e.end_time, '23:59:59.999999'::time) > t.start_time") &&
    migrationHardening.includes("ec.start_time < v_end"),
);
invariant(
  "CRM Lite timeline records business interaction sources",
  schema.includes("kind in ('note', 'booking', 'registration', 'message', 'campaign')") &&
    schema.includes("registration_id uuid references registrations") &&
    migrationRegistration.includes("crm_interactions_kind_check") &&
    read("lib/crm-interactions.ts").includes("recordCrmInteraction") &&
    read("app/api/booking/reserve/route.ts").includes('kind: "booking"') &&
    read("app/api/registration/register/route.ts").includes('kind: "registration"') &&
    read("app/api/cron/marketing/route.ts").includes('kind: "campaign"'),
);
invariant(
  "public read APIs are rate limited",
  read("app/api/booking/availability/route.ts").includes("rateLimitResponse") &&
    read("app/api/booking/config/route.ts").includes("rateLimitResponse") &&
    read("app/api/booking/my/route.ts").includes("rateLimitResponse") &&
    read("app/api/registration/events/route.ts").includes("rateLimitResponse") &&
    read("app/api/registration/events/[id]/route.ts").includes("rateLimitResponse"),
);
invariant(
  "reports expose required operational dimensions",
  read("app/admin/reports/page.tsx").includes("服務提供者") &&
    read("app/admin/reports/page.tsx").includes("票種") &&
    read("app/api/admin/reports/route.ts").includes("services(name)") &&
    read("app/api/admin/reports/route.ts").includes("event_ticket_types(name)"),
);
invariant(
  "reports paginate large tenant datasets",
  read("lib/supabase-pagination.ts").includes("const PAGE_SIZE = 1000") &&
    read("app/admin/reports/page.tsx").includes("fetchAllSupabasePages") &&
    read("app/api/admin/reports/route.ts").includes("fetchAllSupabasePages"),
);
invariant(
  "reports calculate no-show rates from effective records",
  read("app/admin/reports/page.tsx").includes("validAppointmentRows") &&
    read("app/admin/reports/page.tsx").includes("validRegistrationRows") &&
    read("app/admin/reports/page.tsx").includes('status === "no_show"') &&
    read("app/admin/reports/page.tsx").includes("報名未到（分母：有效報名）"),
);
invariant(
  "inactive marketing automation scans its configured trigger window",
  marketingCron.includes("const inactivityDays = Math.max(1, automation.trigger_days)") &&
    marketingCron.includes("inactivityDays * 24 * 60 * 60 * 1000") &&
    marketingCron.includes("const nowMs = Date.now()"),
);
invariant(
  "marketing automation paginates large tenant datasets",
  marketingCron.includes("const ID_BATCH_SIZE = 200") &&
    marketingCron.includes("const QUERY_PAGE_SIZE = 1000") &&
    marketingCron.includes(".range(offset, offset + QUERY_PAGE_SIZE - 1)"),
);
invariant(
  "LINE failures do not block Email marketing or reminders",
  marketingCron.includes("trigger_days, cooldown_days") &&
    marketingCron.includes("lineAccessToken: string | null") &&
    marketingCron.includes('automation.channel === "line"') &&
    remindersCron.includes("rows.some((appointment) => Boolean(appointment.patients?.line_user_id))") &&
    remindersCron.includes('emailConfigForClinic(clinicId)') &&
    marketingCron.includes('emailConfigForClinic(clinicId)') &&
    !read("lib/email.ts").includes("fromOverride"),
);
invariant(
  "status audit records authenticated actor context",
  schema.includes("v_actor uuid := auth.uid()") &&
    schema.includes("source, actor_id") &&
    migrationHardening.includes("v_actor uuid := auth.uid()"),
);
invariant(
  "public registration APIs enforce tenant and publish switches",
  registrationApi.includes("public_registration_enabled") &&
    registrationApi.includes('.eq("clinic_id", clinicId)') &&
    registrationApi.includes('.eq("clinic_id", event.clinic_id)') &&
    registrationDetailApi.includes('.eq("clinic_id", clinicId)') &&
    registrationDetailApi.includes('eq("clinic_id", event.clinic_id)') &&
    registrationEventsApi.includes("const now = Date.now()") &&
    registrationEventsApi.includes("registration_open_at") &&
    registrationEventsApi.includes("registration_close_at"),
);
invariant(
  "private event links are hash-backed and excluded from public listings",
  schema.includes("access_mode text not null default 'public'") &&
    schema.includes("access_token_hash text") &&
    migrationRegistration.includes("events_access_mode_check") &&
    read("app/api/registration/events/route.ts").includes('eq("access_mode", "public")') &&
    registrationDetailApi.includes("access_token_hash") &&
    registrationApi.includes("p_access_token") &&
    read("app/admin/events/actions.ts").includes("randomBytes(24)") &&
    read("app/admin/events/page.tsx").includes("重新產生私密連結"),
);
invariant(
  "public and LINE tenant resolvers reject inactive or unknown brands",
  read("lib/public-brand.ts").includes('.eq("active", true).maybeSingle()') &&
    read("lib/public-brand.ts").includes("isSharedHost") &&
    read("lib/public-brand.ts").includes("if (!isSharedHost(host)) return null") &&
    read("app/api/line/webhook/route.ts").includes("brand destination not configured"),
);
invariant(
  "public payment creation respects the registration publish switch",
  paymentCreateApi.includes("public_registration_enabled") && paymentCreateApi.includes("目前暫停公開報名付款"),
);
invariant(
  "registration export is protected from provider-wide access",
  registrationAdminApi.includes("requireNonProvider") && registrationAdminApi.includes("canViewSensitiveCustomerData"),
);
invariant(
  "booking public switch is enforced by server-side settings",
  read("lib/http.ts").includes("public_booking_enabled") &&
    read("app/api/booking/config/route.ts").includes("public_booking_enabled") &&
    read("app/api/booking/reserve/route.ts").includes("public_booking_enabled") &&
    read("app/api/booking/browser/start/route.ts").includes("public_booking_enabled"),
);
const brandFunction = between(schema, "create or replace function create_brand_with_owner", "revoke all on function create_brand_with_owner");
invariant(
  "new brand creation is atomic, owner-scoped, and seeds settings",
  brandFunction.includes("role in ('owner', 'admin')") &&
    brandFunction.includes("insert into clinic_settings") &&
    brandFunction.includes("insert into clinic_members") &&
    adminActions.includes("createBrandAction") &&
    settingsPage.includes("createBrandAction"),
);
invariant(
  "brand deletion cannot cascade into historical business data",
  schema.includes("pg_constraint") &&
    schema.includes("on delete restrict") &&
    migrationHardening.includes("pg_constraint") &&
    migrationHardening.includes("on delete restrict"),
);
invariant(
  "membership, credit ledger, and discount domain is tenant scoped",
  migrationBenefits.includes("create table if not exists membership_plans") &&
    migrationBenefits.includes("create table if not exists patient_memberships") &&
    migrationBenefits.includes("create table if not exists membership_ledger") &&
    migrationBenefits.includes("create table if not exists discount_codes") &&
    migrationBenefits.includes("create table if not exists discount_redemptions") &&
    migrationBenefits.includes("clinic_id uuid not null references clinics(id) on delete restrict") &&
    migrationBenefits.includes("alter table public.%I enable row level security"),
);
invariant(
  "provider access is assignment-scoped and provider role is immutable",
  schema.includes("create table if not exists doctor_assignments") &&
    migrationHardening.includes("create table if not exists doctor_assignments") &&
    schema.includes("doctor_assignments_self") &&
    read("lib/admin.ts").includes("getAssignedDoctorIds") &&
    read("app/admin/page.tsx").includes("assignedDoctorIds") &&
    read("app/admin/dashboard/page.tsx").includes("assignedDoctorIds") &&
    read("app/admin/queue/page.tsx").includes("assignedDoctorIds") &&
    adminActions.includes("品牌擁有者角色不可變更") &&
    adminActions.includes("品牌擁有者不可移除"),
);
invariant(
  "provider RLS and operational status permissions are assignment-scoped",
  schema.includes("appointments_provider_status_update") &&
    schema.includes("prevent_provider_appointment_writes") &&
    migrationHardening.includes("prevent_provider_appointment_writes") &&
    read("lib/admin.ts").includes("requireStatusOperator") &&
    adminActions.includes("服務提供者只能標記完成或未到") &&
    read("app/admin/queue/page.tsx").includes("服務提供者可標記完成／未到"),
);
invariant(
  "reschedule keeps membership credit and appointment binding atomic",
  schema.includes("create or replace function reschedule_appointment") &&
    migrationBenefits.includes("create or replace function reschedule_appointment") &&
    schema.includes("restore_membership_credit") &&
    schema.includes("consume_membership_credit") &&
    adminActions.includes('rpc("reschedule_appointment"'),
);
invariant(
  "appointment cancellation restores benefits atomically across entry points",
  schema.includes("create or replace function cancel_appointment") &&
    migrationBenefits.includes("create or replace function cancel_appointment") &&
    adminActions.includes('rpc("cancel_appointment"') &&
    read("app/api/booking/cancel/route.ts").includes('rpc("cancel_appointment"') &&
    read("app/api/line/webhook/route.ts").includes('rpc("cancel_appointment"'),
);
invariant(
  "consolidated schema creates membership tables before dependent functions",
  schema.indexOf("create table if not exists membership_plans") >= 0 &&
    schema.indexOf("create table if not exists patient_memberships") > schema.indexOf("create table if not exists membership_plans") &&
    schema.indexOf("create or replace function grant_patient_membership") > schema.indexOf("create table if not exists membership_ledger"),
);
invariant(
  "benefits are transaction-safe and reversible",
  migrationBenefits.includes("pg_advisory_xact_lock(hashtext('registration-benefit:'") &&
    migrationBenefits.includes("create or replace function consume_membership_credit") &&
    migrationBenefits.includes("create or replace function restore_membership_credit") &&
    migrationBenefits.includes("create or replace function release_registration_benefits") &&
    migrationBenefits.includes("create or replace function apply_registration_benefits"),
);
const registrationBenefitsFunction = between(schema, "create or replace function register_for_event_with_benefits", "create or replace function apply_registration_benefits");
const registrationBenefitsMigrationFunction = between(migrationBenefits, "create or replace function register_for_event_with_benefits", "create or replace function apply_registration_benefits");
invariant(
  "discount validation runs after the ticket price is loaded",
  registrationBenefitsFunction.indexOf("if v_code is not null and v_original = 0") > registrationBenefitsFunction.indexOf("v_original := ticket.price") &&
    registrationBenefitsMigrationFunction.indexOf("if v_code is not null and v_original_amount = 0") > registrationBenefitsMigrationFunction.indexOf("v_original_amount := ticket.price"),
);
invariant(
  "confirmed free registrations finalize coupon redemption",
  registrationBenefitsFunction.includes("case when v_status='confirmed' then 'applied' else 'reserved' end") &&
    registrationBenefitsMigrationFunction.includes("case when v_status = 'confirmed' then 'applied' else 'reserved' end"),
);
invariant(
  "public registration and booking can apply benefits through server RPCs",
  registrationApi.includes("register_for_event_with_benefits") &&
    registrationApi.includes("p_discount_code") &&
    registrationApi.includes("p_membership_code") &&
    read("app/api/booking/reserve/route.ts").includes("book_time_slot_with_membership") &&
    read("app/api/booking/reserve/route.ts").includes("book_number_with_membership"),
);
invariant(
  "registration form snapshot is written in the atomic registration transaction",
  registrationBenefitsFunction.includes("p_form_id uuid") &&
    registrationBenefitsFunction.includes("form_id,form_version") &&
    registrationBenefitsMigrationFunction.includes("p_form_id uuid") &&
    registrationBenefitsMigrationFunction.includes("form_id, form_version") &&
    registrationApi.includes("p_form_id: form?.id") &&
    !registrationApi.includes('.from("registrations").update({ form_id'),
);
invariant(
  "registration cancellation releases benefits and promotes waitlist atomically",
  schema.includes("create or replace function cancel_registration_by_id") &&
    schema.includes("perform release_registration_benefits(p_clinic_id, r.id)") &&
    migrationBenefits.includes("create or replace function cancel_registration_by_id") &&
    registrationAdminActions.includes('rpc("cancel_registration_by_id"') &&
    !read("app/api/registration/cancel/route.ts").includes('rpc("release_registration_benefits"'),
);
invariant(
  "benefits are manageable from the protected admin surface",
  exists("app/admin/memberships/page.tsx") &&
    exists("app/admin/memberships/actions.ts") &&
    read("components/AdminNav.tsx").includes("/admin/memberships"),
);
invariant(
  "role matrix is synchronized and narrows authenticated RLS",
  schema.includes(migrationRoleMatrix.trim()) &&
    migrationRoleMatrix.includes("clinic_settings_manage") &&
    migrationRoleMatrix.includes("serving_member") &&
    migrationRoleMatrix.includes("line_replies_member") &&
    migrationRoleMatrix.includes("crm_interactions_insert") &&
    migrationRoleMatrix.includes("appointments_provider_status_update") &&
    migrationRoleMatrix.includes("role in ('owner','admin')") &&
    migrationRoleMatrix.includes("role in ('owner','admin','frontdesk','staff')"),
);

if (failures.length > 0) {
  console.error(`\nContract verification failed: ${failures.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log("\nContract verification passed.");
}
