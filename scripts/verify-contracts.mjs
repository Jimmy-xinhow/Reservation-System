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

const schema = read("supabase/schema.sql").replace(/\r\n/g, "\n");
const migrationRegistration = read("supabase/migration_registration_payments.sql");
const migrationHardening = read("supabase/migration_v3_hardening.sql");
const migrationBenefits = read("supabase/migration_memberships_coupons.sql");
const migrationRoleMatrix = read("supabase/migration_role_matrix_v4.sql");
const migrationMarketingOptIn = read("supabase/migration_marketing_opt_in_sync.sql");
const migrationSaasPlatform = read("supabase/migration_saas_platform.sql");
const migrationSaasCoreGaps = read("supabase/migration_saas_core_gaps.sql");
const migrationCustomerPortal = read("supabase/migrations/202608060001_customer_portal_identity.sql");
const migrationFunnel = read("supabase/migrations/202608060002_funnel_events.sql");
const migrationRegistrationPatient = read("supabase/migrations/202608060003_registration_patient_transaction.sql");
const migrationCrossIndustry = read("supabase/migrations/202608060004_cross_industry_booking_foundation.sql");
const migrationLegacyProgress = read("supabase/migrations/202608060005_isolate_legacy_progress.sql");
const migrationServiceReschedule = read("supabase/migrations/202608060006_service_reschedule_transaction.sql");
const migrationSameDayReschedule = read("supabase/migrations/202608060007_reschedule_same_day_fix.sql");
const migrationProductModulesLineRichMenu = read("supabase/migrations/202608110001_product_modules_line_richmenu.sql");
const migrationAppointmentWaitlist = read("supabase/migrations/202608110002_appointment_waitlist.sql");
const migrationAppointmentWaitlistSurfaces = read("supabase/migrations/202608110003_appointment_waitlist_surfaces.sql");
const migrationRichMenuOptimization = read("supabase/migrations/202608110004_richmenu_optimization.sql");
const migrationDbLintHardening = read("supabase/migrations/202608110005_db_lint_hardening.sql");
const migrationDbLintFollowup = read("supabase/migrations/202608110006_db_lint_followup.sql");
const migrationWaitlistCapacityFix = read("supabase/migrations/202608110007_waitlist_capacity_error_fix.sql");
const migrationTwoLevelAdminPermissions = read("supabase/migrations/202608110008_two_level_admin_permissions.sql");
const migrationServiceBookingSegmentFix = read("supabase/migrations/202608120001_service_booking_segment_fix.sql");
const migrationProviderRlsRecursionFix = read("supabase/migrations/202608120002_provider_rls_recursion_fix.sql");
const migrationRegistrationNumberFix = read("supabase/migrations/202608130001_registration_number_sequence_fix.sql");
const migrationSharedResourceCapacityLock = read("supabase/migrations/202608130002_shared_resource_capacity_lock.sql");
const migrationBrandConfigurationPermissions = read("supabase/migrations/202608130004_brand_configuration_permission_boundaries.sql");
const migrationAdoptionTooling = read("supabase/migrations/202608130005_adoption_and_operations_tooling.sql");
const migrationTrialGuard = read("supabase/migrations/202608130006_trial_observation_guard.sql");
const migrationBookingGrowth = read("supabase/migrations/202608130007_booking_growth_features.sql");
const migrationAddonAvailability = read("supabase/migrations/202608130008_addon_availability.sql");
const migrationRecurringLintFix = read("supabase/migrations/202608130009_recurring_booking_lint_fix.sql");
const migrationApiRateLimits = read("supabase/migrations/202609020001_api_rate_limits.sql");
const migrationPlatformReportAggregation = read("supabase/migrations/202609020002_platform_report_aggregation.sql");
const migrationCourseLearning = read("supabase/migrations/202609030002_course_learning_center.sql");
const migrationBeautyOperations = read("supabase/migrations/202609030003_beauty_operations.sql");
const migrationCheckoutCenter = read("supabase/migrations/202609040001_checkout_center.sql");
const migrationCustomerValue = read("supabase/migrations/202609040002_customer_value_and_followups.sql");
const migrationIndustryPacks = read("supabase/migrations/202609040003_industry_packs.sql");
const migrationCheckoutLintCleanup = read("supabase/migrations/202609040005_checkout_lint_cleanup.sql");
const stagingRunbook = read("docs/staging-acceptance-runbook.md");
const smokePublic = read("scripts/smoke-public.mjs");
const projectReadme = read("README.md");
const envExample = read(".env.example");

const checks = [
  ["auth invites return to the deployed app and support password setup", ["lib/auth-invite.ts|authInviteRedirectUrl", "app/admin/platform/actions.ts|redirectTo: authInviteRedirectUrl()", "app/admin/platform/admins/actions.ts|redirectTo: authInviteRedirectUrl()", "app/auth/accept-invite/page.tsx|exchangeCodeForSession", "app/auth/accept-invite/page.tsx|updateUser({ password })", "components/AuthCallbackBridge.tsx|window.location.replace"]],
  ["registration payment migration has core tables", ["create table if not exists events", "create table if not exists registrations", "create table if not exists payment_orders"]],
  ["registration answer snapshot is in consolidated schema", ["create table if not exists registration_answers", "insert into registration_answers"]],
  ["status and notification audit tables are in consolidated schema", ["create table if not exists appointment_status_events", "create table if not exists appointment_notification_logs", "create table if not exists registration_status_events", "create table if not exists registration_notification_logs", "create table if not exists payment_status_events"]],
  ["hardening trigger and queue functions are in consolidated schema", ["record_appointment_status_event", "record_registration_status_event", "promote_waitlist_for_session", "expire_registration_payments"]],
  ["dynamic RLS includes new tenant tables", ["registration_answers", "appointment_status_events", "appointment_notification_logs", "registration_notification_logs", "payment_status_events"]],
  ["server-only secret boundaries exist", ["lib/email.ts|import \"server-only\"", "lib/payment.ts|import \"server-only\"", "lib/registration-notifications.ts|import \"server-only\"", "lib/appointment-notifications.ts|import \"server-only\"", "lib/browser-booking.ts|import \"server-only\""]],
  ["unexpected API errors are generic and traceable", ["lib/http.ts|if (status >= 500)", "lib/http.ts|error_id: errorId", "lib/http.ts|系統暫時無法完成操作", "lib/http.ts|detail: message.replace"]],
  ["LINE identity failures do not expose provider details", ["app/api/booking/reserve/route.ts|LINE 身分驗證失敗，請重新開啟預約頁。", "app/api/booking/reschedule/route.ts|LINE 身分驗證失敗，請重新開啟預約頁。", "app/api/customer/portal/route.ts|LINE 身分驗證失敗，請重新開啟頁面。"]],
  ["public API rate limiting is shared, atomic, and privacy-safe", ["supabase/migrations/202609020001_api_rate_limits.sql|on conflict (bucket_key) do update", "supabase/migrations/202609020001_api_rate_limits.sql|alter table public.api_rate_limit_buckets enable row level security", "supabase/migrations/202609020001_api_rate_limits.sql|grant execute on function public.consume_api_rate_limit", "lib/rate-limit.ts|createHash(\"sha256\")", "lib/rate-limit.ts|shared store unavailable; using local fallback", "lib/rate-limit.ts|MAX_LOCAL_BUCKETS"]],
  ["platform usage report is aggregated by PostgreSQL", ["supabase/migrations/202609020002_platform_report_aggregation.sql|get_platform_usage_summary", "supabase/migrations/202609020002_platform_report_aggregation.sql|group by clinic_id", "supabase/migrations/202609020002_platform_report_aggregation.sql|grant execute on function public.get_platform_usage_summary() to service_role", "app/admin/platform/reports/page.tsx|service.rpc(\"get_platform_usage_summary\")"]],
  ["admin UI has a readable and keyboard-visible baseline", ["app/globals.css|.admin-shell .text-xs", "app/globals.css|.admin-shell .text-slate-400", "app/globals.css|:focus-visible", "app/globals.css|.inline-action", "app/admin/layout.tsx|admin-shell min-h-screen"]],
  ["admin navigation uses task language for technical modules", ["components/AdminNav.tsx|顧客回訪與自動提醒", "components/AdminNav.tsx|LINE 訊息範本", "components/AdminNav.tsx|通知與付款測試", "components/AdminNav.tsx|LINE 官方帳號連線", "components/AdminNav.tsx|LINE 圖文選單"]],
  ["LINE setup presents plain steps before technical identifiers", ["app/admin/line/page.tsx|照順序完成 3 件事", "app/admin/line/page.tsx|進階技術設定：LINE 識別碼", "app/admin/line/page.tsx|Webhook 是 LINE 把顧客操作傳回本系統的接收網址"]],
  ["public tenant resolver is present", ["lib/public-brand.ts|resolvePublicClinicId"]],
  ["public and fallback routes exist", ["app/register/page.tsx", "app/book/browser/page.tsx", "app/book/browser/my/page.tsx", "app/book/browser/reschedule/page.tsx", "app/book/reschedule/page.tsx", "app/api/booking/browser/start/route.ts", "app/api/booking/browser/my/route.ts", "app/api/booking/reschedule/route.ts", "app/embed/book/page.tsx", "app/embed/register/page.tsx"]],
  ["admin SaaS modules exist", ["app/admin/crm/page.tsx", "app/admin/reports/page.tsx", "app/admin/registrations/page.tsx", "app/admin/checkin/page.tsx", "app/admin/calendar/page.tsx", "app/api/registration/checkin-search/route.ts"]],
  ["course learning center is registration-gated and server mediated", ["supabase/migrations/202609030002_course_learning_center.sql|create table if not exists public.course_units", "supabase/migrations/202609030002_course_learning_center.sql|create table if not exists public.course_unit_progress", "app/api/customer/learning/route.ts|verifyBrowserBookingToken", "app/api/customer/learning/route.ts|baseAccess", "app/api/customer/learning/route.ts|尚未符合這個教材的開放條件", "app/learn/page.tsx|setScope(scopeSuffix())", "app/learn/page.tsx|href={`/my${scope}`}", "app/admin/course-content/page.tsx"]],
  ["industry packs cover beauty procurement, fitness freezes, course assessments, and consent", ["supabase/migrations/202609040003_industry_packs.sql|create table if not exists public.purchase_orders", "supabase/migrations/202609040003_industry_packs.sql|finalize_inventory_stocktake", "supabase/migrations/202609040003_industry_packs.sql|sync_subscription_freezes", "supabase/migrations/202609040003_industry_packs.sql|create table if not exists public.course_assessments", "supabase/migrations/202609040003_industry_packs.sql|create table if not exists public.course_certificates", "supabase/migrations/202609040003_industry_packs.sql|create table if not exists public.customer_document_requests", "supabase/migrations/202609040004_course_unit_content_check.sql|unit_type in ('quiz','assignment') or content_url is not null or body is not null", "app/admin/beauty/supply/page.tsx|採購與盤點", "app/admin/fitness/page.tsx|教室與會籍營運", "app/admin/documents/page.tsx|同意書與電子簽署", "app/api/customer/learning/route.ts|correct_option", "app/api/customer/learning/route.ts|assessment:state.available"]],
  ["add-on evaluation separates reusable core from external-account dependencies", ["docs/add-on-evaluation-2026-09-04.md|Cal.com", "docs/add-on-evaluation-2026-09-04.md|ERPNext", "docs/add-on-evaluation-2026-09-04.md|Moodle", "docs/add-on-evaluation-2026-09-04.md|syncToken", "docs/add-on-evaluation-2026-09-04.md|不代表外部服務已完成串接", "app/admin/settings/add-ons/page.tsx|等待外部帳號", "app/admin/settings/add-ons/page.tsx|需要規則確認", "components/AdminNav.tsx|擴充功能規劃"]],
  ["beauty operations are optional and privacy bounded", ["supabase/migrations/202609030003_beauty_operations.sql|beauty_operations_enabled", "supabase/migrations/202609030003_beauty_operations.sql|record_inventory_movement", "app/api/admin/beauty-photo/route.ts|public: false", "app/admin/beauty/page.tsx|不是薪資、稅務或會計結算", "app/admin/settings/page.tsx|不是完整會計或 POS"]],
  ["checkout center is tenant scoped and server mediated", ["supabase/migrations/202609040001_checkout_center.sql|create table if not exists public.sales_orders", "supabase/migrations/202609040001_checkout_center.sql|create table if not exists public.sales_order_items", "supabase/migrations/202609040001_checkout_center.sql|create table if not exists public.sales_payments", "supabase/migrations/202609040001_checkout_center.sql|record_inventory_movement", "supabase/migrations/202609040001_checkout_center.sql|grant execute on function public.create_sales_order", "app/admin/checkout/actions.ts|requireOperator", "app/admin/checkout/actions.ts|createServiceClient().rpc", "app/admin/checkout/page.tsx|結帳中心"]],
  ["checkout lint cleanup preserves the tenant-scoped function contract", ["supabase/migrations/202609040005_checkout_lint_cleanup.sql|create or replace function public.create_sales_order", "supabase/migrations/202609040005_checkout_lint_cleanup.sql|checkout actor is not allowed", "supabase/migrations/202609040005_checkout_lint_cleanup.sql|grant execute on function public.create_sales_order"]],
  ["customer value and scheduled follow-ups are ledger based and tenant scoped", ["supabase/migrations/202609040002_customer_value_and_followups.sql|create table if not exists public.customer_wallet_ledger", "supabase/migrations/202609040002_customer_value_and_followups.sql|create table if not exists public.loyalty_ledger", "supabase/migrations/202609040002_customer_value_and_followups.sql|create table if not exists public.patient_subscriptions", "supabase/migrations/202609040002_customer_value_and_followups.sql|create or replace function public.merge_customers", "supabase/schema.sql|create or replace function public.merge_customers", "supabase/migrations/202609040002_customer_value_and_followups.sql|for update skip locked", "app/admin/customer-value/page.tsx|顧客資產與訂閱", "app/admin/followups/actions.ts|new Date(`${value}+08:00`)", "app/admin/followups/page.tsx|指定日期回訪", "app/api/cron/followups/route.ts|claim_due_scheduled_followups"]],
  ["shared login exposes accessible brand and system destinations without granting roles client-side", ["app/admin/login/page.tsx|品牌營運後台", "app/admin/login/page.tsx|系統管理後台", "app/admin/login/page.tsx|實際權限仍由帳號角色在伺服器端判定", "app/admin/login/page.tsx|htmlFor=\"admin-email\"", "app/admin/login/page.tsx|htmlFor=\"admin-password\"", "app/admin/login/page.tsx|/admin/platform", "lib/platform.ts|platform_admins"]],
  ["system administration layer exists and is server-guarded", ["supabase/migration_saas_platform.sql|create table if not exists public.platform_admins", "supabase/migration_saas_platform.sql|create table if not exists public.brand_entitlements", "lib/platform.ts|requirePlatformAdmin", "lib/platform.ts|requireSystemAdmin", "lib/platform.ts|requireSystemPermission", "app/admin/platform/page.tsx", "app/admin/platform/admins/page.tsx", "app/admin/platform/admins/actions.ts", "app/admin/platform/operations/page.tsx", "app/admin/platform/reports/page.tsx", "app/admin/platform/audit/page.tsx", "app/admin/platform/settings/page.tsx", "app/admin/platform/actions.ts", "app/admin/page.tsx|redirect(\"/admin/platform\")", "app/admin/layout.tsx|XINHOW PLATFORM", "components/AdminNav.tsx|系統管理總控台"]],
  ["two management identities and employee permissions are explicit", ["lib/platform-roles.ts|PlatformAccessType = \"system_admin\" | \"employee\"", "lib/platform-roles.ts|SYSTEM_PERMISSION_DEFINITIONS", "lib/access-control.ts|BrandAccessType = \"brand_admin\" | \"employee\"", "lib/access-control.ts|BRAND_PERMISSION_DEFINITIONS", "supabase/migrations/202608110008_two_level_admin_permissions.sql|access_type", "supabase/migrations/202608110008_two_level_admin_permissions.sql|permissions text[]", "app/admin/platform/admins/actions.ts|requireSystemAdmin", "app/admin/users/actions.ts|requireBrandAdmin", "app/admin/layout.tsx|hasDualAdminContext", "app/admin/layout.tsx|<a href=\"/admin/dashboard\"", "app/admin/layout.tsx|<a href=\"/admin/platform\""]],
  ["time-mode service bookings resolve their real schedule segment", ["supabase/migrations/202608120001_service_booking_segment_fix.sql|v_date := (v_appointment.start_at at time zone 'Asia/Taipei')::date", "supabase/migrations/202608120001_service_booking_segment_fix.sql|template.weekday = extract(dow from v_date)", "supabase/migrations/202608120001_service_booking_segment_fix.sql|v_time >= template.start_time", "supabase/migrations/202608120001_service_booking_segment_fix.sql|service duration exceeds schedule segment"]],
  ["provider appointment status updates avoid recursive patient policies", ["supabase/migrations/202608120002_provider_rls_recursion_fix.sql|provider_has_patient_assignment", "supabase/migrations/202608120002_provider_rls_recursion_fix.sql|p_user_id = auth.uid()", "supabase/migrations/202608120002_provider_rls_recursion_fix.sql|drop policy if exists patients_provider_read", "supabase/migrations/202608120002_provider_rls_recursion_fix.sql|drop policy if exists patient_records_provider_read"]],
  ["shared resource capacity is locked across different services", ["supabase/migrations/202608130002_shared_resource_capacity_lock.sql|enforce_appointment_resource_capacity", "supabase/migrations/202608130002_shared_resource_capacity_lock.sql|order by assignment.resource_id", "supabase/migrations/202608130002_shared_resource_capacity_lock.sql|pg_advisory_xact_lock", "supabase/migrations/202608130002_shared_resource_capacity_lock.sql|trg_appointments_resource_capacity"]],
  ["appointment deposit expiry can persist the failed lifecycle state", ["supabase/migrations/202608130003_appointment_deposit_failed_status.sql|appointments_deposit_status_check", "supabase/migrations/202608130003_appointment_deposit_failed_status.sql|'failed'", "deposit_status in ('none','pending','paid','failed','waived','refunded')", "create or replace function expire_pending_appointment_deposits()"]],
  ["brand configuration pages and RLS require brand management permission", ["app/admin/services/page.tsx|requireAdmin()", "app/admin/resources/page.tsx|requireAdmin()", "app/admin/schedules/page.tsx|requireAdmin()", "app/admin/exceptions/page.tsx|requireAdmin()", "app/admin/audit/page.tsx|requireAdmin()", "supabase/migrations/202608130004_brand_configuration_permission_boundaries.sql|'brand.manage' = any(member.permissions)", "supabase/migrations/202608130004_brand_configuration_permission_boundaries.sql|schedule_templates_brand_manage", "supabase/migrations/202608130004_brand_configuration_permission_boundaries.sql|schedule_exceptions_brand_manage"]],
  ["adoption metrics and first-stage tools are tenant isolated", ["supabase/migrations/202608130005_adoption_and_operations_tooling.sql|create table if not exists public.clinic_activation_metrics", "supabase/migrations/202608130005_adoption_and_operations_tooling.sql|create table if not exists public.admin_product_events", "supabase/migrations/202608130005_adoption_and_operations_tooling.sql|create table if not exists public.data_import_jobs", "supabase/migrations/202608130005_adoption_and_operations_tooling.sql|create table if not exists public.channel_test_runs", "supabase/migrations/202608130005_adoption_and_operations_tooling.sql|create table if not exists public.handoff_tasks", "supabase/migrations/202608130005_adoption_and_operations_tooling.sql|revoke all on table public.admin_product_events from public, anon, authenticated", "app/admin/import/page.tsx", "app/admin/channels/page.tsx", "app/admin/handoff/page.tsx"]],
  ["three-brand observation limit is atomic", ["supabase/migrations/202608130006_trial_observation_guard.sql|pg_advisory_xact_lock", "supabase/migrations/202608130006_trial_observation_guard.sql|>= 3", "app/admin/platform/reports/TrialObservationPanel.tsx|未發生的行為顯示為「尚無資料」"]],
  ["booking growth options stay atomic and configuration driven", ["supabase/migrations/202608130007_booking_growth_features.sql|create table if not exists public.service_addons", "supabase/migrations/202608130007_booking_growth_features.sql|create table if not exists public.appointment_series", "supabase/migrations/202608130007_booking_growth_features.sql|book_recurring_appointments", "supabase/migrations/202608130007_booking_growth_features.sql|recurring_booking_enabled", "supabase/migrations/202608130008_addon_availability.sql|get_available_service_slots_with_options", "app/api/booking/reserve/route.ts|book_time_slot_with_options", "app/book/MyAppointments.tsx|再次預約", "app/book/browser/page.tsx|每週重複預約"]],
  ["core SaaS gap migration and customer surfaces exist", ["supabase/migration_saas_core_gaps.sql|membership_notification_logs", "supabase/migration_saas_core_gaps.sql|service_resources_available", "supabase/migration_saas_core_gaps.sql|get_available_sessions_for_service", "app/api/cron/membership/route.ts|MEMBERSHIP_EXPIRY_NOTICE_DAYS", "app/api/membership/portal/route.ts", "app/api/registration/my/route.ts", "app/api/registration/checkin-live/route.ts", "app/admin/audit/page.tsx"]],
  ["unified customer portal migration and funnel tracking exist", ["app/api/customer/portal/route.ts", "app/my/page.tsx", "components/FunnelTracker.tsx", "lib/funnel-client.ts", "app/api/analytics/funnel/route.ts"]],
  ["cross-industry service targets and customer actions exist", ["supabase/migrations/202608060004_cross_industry_booking_foundation.sql|booking_target", "supabase/migrations/202608060004_cross_industry_booking_foundation.sql|book_service_slot", "app/admin/_components/ExceptionForm.tsx|service_id", "app/api/customer/registration-action/route.ts|cancel_registration_for_customer"]],
  ["legacy progress is isolated behind an explicit opt-in", ["supabase/migrations/202608060005_isolate_legacy_progress.sql|legacy_progress_enabled", "lib/legacy-progress.ts|isLegacyProgressEnabled", "app/q/page.tsx|未開放服務進度頁", "app/api/line/webhook/route.ts|cs?.legacy_progress_enabled === true"]],
  ["service-only reschedule stays atomic", ["supabase/migrations/202608060006_service_reschedule_transaction.sql|reschedule_service_appointment", "supabase/migrations/202608060006_service_reschedule_transaction.sql|restore_membership_credit", "supabase/migrations/202608060006_service_reschedule_transaction.sql|status = 'cancelled'"]],
  ["same-day reschedule releases the old booking inside one transaction", ["supabase/migrations/202608060007_reschedule_same_day_fix.sql|same-day reschedule", "supabase/migrations/202608060007_reschedule_same_day_fix.sql|update public.appointments set status = 'cancelled'"]],
  ["product modules are settings-driven and separate from public switches", ["supabase/migrations/202608110001_product_modules_line_richmenu.sql|events_enabled", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|memberships_enabled", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|crm_automation_enabled", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|line_channel_enabled"]],
  ["per-brand LINE metadata contains no channel secrets", ["supabase/migrations/202608110001_product_modules_line_richmenu.sql|create table if not exists public.clinic_line_channels", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|login_channel_id text", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|liff_id text", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|clinic_line_channels_admin"]],
  ["Rich Menu drafts and publications are versioned and auditable", ["supabase/migrations/202608110001_product_modules_line_richmenu.sql|create table if not exists public.line_richmenu_versions", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|create table if not exists public.line_richmenu_publication_events", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|draft_version_id", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|published_version_id", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|create_line_richmenu_version"]],
  ["appointment waitlist is separate from event registration waitlist", ["supabase/migrations/202608110002_appointment_waitlist.sql|create table if not exists public.appointment_waitlist_entries", "supabase/migrations/202608110002_appointment_waitlist.sql|create table if not exists public.appointment_waitlist_events", "supabase/migrations/202608110002_appointment_waitlist.sql|create table if not exists public.appointment_waitlist_notification_logs", "supabase/migrations/202608110002_appointment_waitlist.sql|waitlist_entry_id uuid"]],
  ["appointment waitlist lifecycle is atomic and resumable", ["supabase/migrations/202608110002_appointment_waitlist.sql|create or replace function public.join_appointment_waitlist", "supabase/migrations/202608110002_appointment_waitlist.sql|create or replace function public.offer_next_appointment_waitlist", "supabase/migrations/202608110002_appointment_waitlist.sql|create or replace function public.accept_appointment_waitlist_offer", "supabase/migrations/202608110002_appointment_waitlist.sql|create or replace function public.expire_appointment_waitlist_offers", "supabase/migrations/202608110002_appointment_waitlist.sql|for update skip locked", "supabase/migrations/202608110002_appointment_waitlist.sql|pg_advisory_xact_lock"]],
  ["appointment waitlist has customer, browser, operator, and delivery surfaces", ["supabase/migrations/202608110003_appointment_waitlist_surfaces.sql|create or replace function public.get_appointment_waitlist_targets", "supabase/migrations/202608110003_appointment_waitlist_surfaces.sql|create or replace function public.claim_appointment_waitlist_notifications", "supabase/migrations/202608110003_appointment_waitlist_surfaces.sql|for update skip locked", "app/api/booking/waitlist/route.ts|verifyClinicLiffIdToken", "app/api/booking/waitlist/route.ts|verifyBrowserBookingToken", "app/book/page.tsx|確認加入候補", "app/book/browser/my/page.tsx|接受名額", "app/admin/appointment-actions.ts|cancelAppointmentWaitlistAction", "lib/appointment-waitlist-notifications.ts|processAppointmentWaitlistNotificationQueue"]],
  ["per-brand LINE channel writes are atomic and role-checked", ["supabase/migrations/202608110001_product_modules_line_richmenu.sql|create or replace function public.update_clinic_line_channel", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|actor identity mismatch", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|brand admin access required", "supabase/migrations/202608110001_product_modules_line_richmenu.sql|grant execute on function public.update_clinic_line_channel"]],
  ["LINE channel readiness is verified and persisted server-side", ["lib/line.ts|/channel/webhook/endpoint", "app/admin/line-actions.ts|verifyLineChannelSettingsAction", "app/admin/line-actions.ts|const service = createServiceClient()", "app/admin/line-actions.ts|verification_status: \"ready\"", "app/admin/line-actions.ts|verification_status: \"error\"", "app/admin/line/page.tsx|重新檢查連線"]],
  ["unified customer entry contract exists", ["lib/customer-entry.ts|CUSTOMER_ENTRY_DEFINITIONS", "lib/customer-entry.ts|customerEntryUrl", "docs/customer-entry-contract.md|LIFF ID token"]],
  ["Rich Menu optimization has alias, schedule, and clone contracts", ["supabase/migrations/202608110004_richmenu_optimization.sql|create table if not exists public.line_richmenu_aliases", "supabase/migrations/202608110004_richmenu_optimization.sql|create table if not exists public.line_richmenu_schedules", "supabase/migrations/202608110004_richmenu_optimization.sql|clone_line_richmenu_version", "supabase/migrations/202608110004_richmenu_optimization.sql|claim_due_line_richmenu_schedules"]],
  ["database lint findings have an explicit hardening migration", ["supabase/migrations/202608110005_db_lint_hardening.sql|on conflict on constraint clinic_settings_pkey", "supabase/migrations/202608110005_db_lint_hardening.sql|on conflict on constraint clinic_members_pkey", "supabase/migrations/202608110005_db_lint_hardening.sql|membership.membership_code = v_code", "supabase/migrations/202608110005_db_lint_hardening.sql|redemption.registration_id = registration_result.registration_id", "supabase/migrations/202608110005_db_lint_hardening.sql|select booking.appointment_id into new_appointment_id"]],
  ["database lint follow-up fixes are present", ["supabase/migrations/202608110006_db_lint_followup.sql|alter table public.clinics", "supabase/migrations/202608110006_db_lint_followup.sql|create or replace function public.record_line_richmenu_publication", "supabase/migrations/202608110006_db_lint_followup.sql|create or replace function public.finish_line_richmenu_schedule", "supabase/migrations/202608110006_db_lint_followup.sql|create or replace function public.offer_next_appointment_waitlist"]],
  ["waitlist capacity errors preserve queue position", ["supabase/migrations/202608110007_waitlist_capacity_error_fix.sql|v_error like '%額滿%'", "supabase/migrations/202608110007_waitlist_capacity_error_fix.sql|v_error like '%slot is full%'", "supabase/migrations/202608110007_waitlist_capacity_error_fix.sql|v_error like '%session is full%'", "supabase/migrations/202608110007_waitlist_capacity_error_fix.sql|return;"]],
  ["staging browser identity audit covers ownership and cross-brand rejection", ["package.json|audit:staging-browser-identity", "scripts/staging-browser-identity-audit.mjs|有效 token 只列出同品牌且屬於自己的預約", "scripts/staging-browser-identity-audit.mjs|同品牌 token 不可取消其他顧客預約", "scripts/staging-browser-identity-audit.mjs|同品牌 token 不可改期其他顧客預約", "scripts/staging-browser-identity-audit.mjs|品牌 B token 無法讀取品牌 A 入口", "scripts/staging-browser-identity-audit.mjs|URL clinic_slug 無法把已驗證網域切換到其他品牌", "scripts/staging-browser-identity-audit.mjs|竄改的瀏覽器 token 被拒絕"]],
  ["single staging core gate runs public smoke and every domain audit", ["package.json|audit:staging-core", "scripts/staging-core-acceptance.mjs|smoke-public.mjs", "scripts/staging-core-acceptance.mjs|staging-security-audit.mjs", "scripts/staging-core-acceptance.mjs|staging-booking-audit.mjs", "scripts/staging-core-acceptance.mjs|staging-commerce-audit.mjs", "scripts/staging-core-acceptance.mjs|staging-notification-audit.mjs", "scripts/staging-core-acceptance.mjs|staging-browser-identity-audit.mjs", "scripts/staging-core-acceptance.mjs|RAILWAY_ENVIRONMENT_NAME", "scripts/staging-core-acceptance.mjs|RAILWAY_PUBLIC_DOMAIN"]],
  ["CI gates cover local quality and four staging admin identities", [".github/workflows/verify.yml|npm run verify:contracts", ".github/workflows/verify.yml|npm run build", ".github/workflows/staging-release-gate.yml|npm run audit:staging-core", ".github/workflows/staging-release-gate.yml|npm run audit:staging-role-ui", "tests/staging-role-ui.spec.mjs|system-admin", "tests/staging-role-ui.spec.mjs|system-employee", "tests/staging-role-ui.spec.mjs|brand-admin", "tests/staging-role-ui.spec.mjs|brand-employee"]],
];

const failures = [];
for (const [label, snippets] of checks) {
  const ok = snippets.every((snippet) => {
    if (snippet.includes("/") || snippet.includes("|")) {
      const [file, ...needleParts] = snippet.split("|");
      const needle = needleParts.join("|");
      return exists(file) && (!needle || read(file).includes(needle));
    }
    return schema.includes(snippet) || migrationRegistration.includes(snippet) || migrationHardening.includes(snippet) || migrationBenefits.includes(snippet) || migrationSaasPlatform.includes(snippet) || migrationSaasCoreGaps.includes(snippet) || migrationCustomerPortal.includes(snippet) || migrationFunnel.includes(snippet) || migrationCrossIndustry.includes(snippet) || migrationLegacyProgress.includes(snippet) || migrationServiceReschedule.includes(snippet) || migrationSameDayReschedule.includes(snippet) || migrationProductModulesLineRichMenu.includes(snippet) || migrationAppointmentWaitlist.includes(snippet) || migrationAppointmentWaitlistSurfaces.includes(snippet) || migrationRichMenuOptimization.includes(snippet) || migrationDbLintHardening.includes(snippet) || migrationDbLintFollowup.includes(snippet) || migrationWaitlistCapacityFix.includes(snippet) || migrationTwoLevelAdminPermissions.includes(snippet) || migrationServiceBookingSegmentFix.includes(snippet) || migrationProviderRlsRecursionFix.includes(snippet) || migrationAdoptionTooling.includes(snippet) || migrationTrialGuard.includes(snippet) || migrationBookingGrowth.includes(snippet) || migrationAddonAvailability.includes(snippet);
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

invariant(
  "database lint hardening removes unused queue variables and is synchronized",
  !migrationDbLintHardening.includes("new_queue_number") &&
    schema.includes("-- Resolve PL/pgSQL output-column ambiguity reported by `supabase db lint`") &&
    schema.indexOf("-- Resolve PL/pgSQL output-column ambiguity reported by `supabase db lint`") <
      schema.indexOf("-- Follow up the staging DB lint findings without rewriting an applied migration."),
);

invariant(
  "database lint follow-up removes staging lint findings",
  migrationDbLintFollowup.includes("add column if not exists updated_at") &&
    migrationDbLintFollowup.includes("select menu.published_version_id") &&
    !migrationDbLintFollowup.includes("current_line_id") &&
    !migrationDbLintFollowup.includes("declare target record") &&
    !migrationDbLintFollowup.includes("v_queue_number") &&
    schema.includes("updated_at timestamptz not null default now()") &&
    schema.includes("select menu.published_version_id\n    into current_version_id") &&
    !schema.includes("  current_line_id text;\n  restore_line_id text;") &&
    !schema.includes("declare target record;") &&
    !schema.includes("  v_queue_number integer;")
);

invariant(
  "consolidated schema ends with the latest booking-growth replay",
  !migrationWaitlistCapacityFix.includes("憿遛") &&
    migrationWaitlistCapacityFix.includes("v_error like '%額滿%'") &&
    migrationTwoLevelAdminPermissions.includes("system_admin") &&
    migrationTwoLevelAdminPermissions.includes("brand_admin") &&
    schema.lastIndexOf("-- Final replay of migration 202608120001") > schema.lastIndexOf("-- Final replay of migration 202608110008") &&
    schema.lastIndexOf("v_date := (v_appointment.start_at at time zone 'Asia/Taipei')::date") > schema.lastIndexOf("-- Final replay of migration 202608110008") &&
    schema.lastIndexOf("get_available_service_slots_with_options") > schema.lastIndexOf("-- Final replay of migration 202608120001") &&
    schema.lastIndexOf("-- Final replay of migration 202608130009") > schema.lastIndexOf("-- Final replay of migration 202608130008") &&
    !migrationRecurringLintFix.includes("v_index integer;") &&
    schema.trimEnd().endsWith("commit;"),
);

invariant(
  "unauthorized system employees are redirected instead of receiving a server error",
  read("lib/platform.ts").includes("if (!hasSystemPermission(context, permission)) {") &&
    read("lib/platform.ts").includes('redirect("/admin/platform?notice=permission")'),
);

invariant(
  "authenticated accounts without workspace access are rejected without a server error",
  read("app/admin/login/page.tsx").includes("/api/admin/access?entry=${entry}") &&
    read("app/admin/login/page.tsx").includes("await supabase.auth.signOut()") &&
    read("app/admin/page.tsx").includes('redirect("/admin/login?reason=no-access")') &&
    read("lib/admin.ts").includes('redirect("/admin/login?reason=brand-access-required")') &&
    read("lib/platform.ts").includes('redirect("/admin/login?reason=platform-access-required")') &&
    exists("app/api/admin/access/route.ts"),
);

invariant(
  "sign out works for both brand and system-only accounts",
  between(read("app/admin/actions.ts"), "export async function signOutAction()", "// ── 今日約診").includes("createSupabaseServer()") &&
    !between(read("app/admin/actions.ts"), "export async function signOutAction()", "// ── 今日約診").includes("requireMember()"),
);

invariant(
  "authorized brand reports read privacy-safe funnel totals through the server boundary",
  read("app/admin/reports/page.tsx").includes('service.from("funnel_events")') &&
    read("app/admin/reports/page.tsx").includes('.eq("clinic_id", clinicId)'),
);

invariant(
  "consolidated provider patient policies use the non-recursive assignment helper",
  schema.lastIndexOf("public.provider_has_patient_assignment(patients.clinic_id, patients.id, auth.uid())") >
      schema.lastIndexOf("select 1 from appointments a\n        join doctor_assignments") &&
    schema.lastIndexOf("public.provider_has_patient_assignment(\n        patient_records.clinic_id") >
      schema.lastIndexOf("select 1 from appointments a\n        join doctor_assignments"),
);

invariant(
  "the shared application shell declares a real site icon",
  read("app/layout.tsx").includes('icons: { icon: "/brand/xinhao-black-light.png" }') &&
    exists("public/brand/xinhao-black-light.png"),
);

invariant(
  "consolidated schema defines touch_updated_at before its first trigger",
  schema.indexOf("create or replace function touch_updated_at") >= 0 &&
    schema.indexOf("create or replace function touch_updated_at") < schema.indexOf("create trigger trg_service_resources_touch"),
);

invariant(
  "public smoke covers public and admin login routes",
    smokePublic.includes('"/register/pay"') &&
    smokePublic.includes('"/book/browser/my"') &&
    smokePublic.includes('"/book/browser/reschedule"') &&
    smokePublic.includes('"/book/reschedule"') &&
    smokePublic.includes('"/register/cancel"') &&
    smokePublic.includes('"/payment/result"') &&
    smokePublic.includes('"/membership"') &&
    smokePublic.includes('"/embed/book"') &&
    smokePublic.includes('"/embed/register"') &&
    smokePublic.includes('"/admin/login"') &&
    smokePublic.includes("/api/cron/marketing") &&
    smokePublic.includes("/api/cron/membership") &&
    smokePublic.includes("/api/cron/richmenu"),
);
invariant(
  "bootstrap documentation matches current roles, hosts, and migration head",
  projectReadme.includes("'brand_admin', array['brand.manage', 'operations.manage']") &&
    projectReadme.includes("PUBLIC_PLATFORM_HOSTS") &&
    projectReadme.includes("202608130009_recurring_booking_lint_fix.sql") &&
    envExample.includes("PLATFORM_ADMIN_USER_IDS=") &&
    envExample.includes("PUBLIC_PLATFORM_HOSTS=") &&
    envExample.includes("SMOKE_BASE_URL=") &&
    envExample.includes("STAGING_BASE_URL="),
);

invariant(
  "payment and email secrets are not schema columns",
  !schema.includes("resend_api_key text") &&
    !schema.includes("hash_key text") &&
    !schema.includes("hash_iv text") &&
    schema.includes("drop column if exists resend_api_key") &&
    schema.includes("drop column if exists hash_key") &&
    migrationHardening.includes("drop column if exists resend_api_key") &&
    migrationHardening.includes("drop column if exists hash_key"),
);

const tenantTables = [
  "chat_messages", "chat_blocks", "crm_segments", "crm_segment_members", "crm_interactions", "crm_automations", "crm_delivery_logs",
  "clinic_domains", "events", "event_sessions", "event_ticket_types", "registration_forms", "registration_form_fields", "registrations",
  "registration_answers", "waitlist_entries", "checkins", "payment_orders", "payment_transactions", "payment_webhook_events",
  "clinic_payment_settings", "appointment_status_events", "appointment_notification_logs", "registration_status_events",
  "registration_notification_logs", "payment_status_events", "membership_plans", "patient_memberships", "membership_ledger",
  "discount_codes", "discount_redemptions", "reminder_logs", "line_messages", "line_auto_replies", "line_richmenu",
  "service_resources", "service_resource_assignments",
  "membership_levels", "membership_plan_level_prices",
  "clinic_line_channels", "line_richmenu_versions", "line_richmenu_publication_events",
  "line_richmenu_aliases", "line_richmenu_schedules",
  "appointment_waitlist_entries", "appointment_waitlist_events", "appointment_waitlist_notification_logs",
  "clinic_activation_metrics", "trial_brand_observations", "admin_product_events", "data_import_jobs", "channel_test_runs", "handoff_tasks", "feature_interest_signals",
  "service_addons", "appointment_series",
];
const dynamicRlsTableText = [...schema.matchAll(/foreach tbl in array array\[(.*?)\]\s*loop/gs)]
  .map((match) => match[1])
  .join("\n");
invariant(
  "all consolidated tenant tables have dynamic RLS coverage",
  schema.includes("alter table public.%I enable row level security") &&
    tenantTables.every((table) =>
      dynamicRlsTableText.includes(`'${table}'`) ||
      schema.includes(`alter table public.${table} enable row level security`),
    ),
);

const lineChannelTable = between(schema, "create table if not exists public.clinic_line_channels", "insert into public.clinic_line_channels");
invariant(
  "per-brand LINE metadata never stores channel credentials",
  lineChannelTable.includes("login_channel_id text") &&
    lineChannelTable.includes("liff_id text") &&
    !/secret|access_token|channel_token/i.test(lineChannelTable),
);
const lineChannelResolver = read("lib/line-channel.ts");
const customerEntryContract = read("lib/customer-entry.ts");
const liffApiRoutes = [
  "app/api/booking/reserve/route.ts",
  "app/api/booking/reschedule/route.ts",
  "app/api/booking/patient/route.ts",
  "app/api/booking/patients-of-line/route.ts",
  "app/api/booking/my/route.ts",
  "app/api/booking/cancel/route.ts",
  "app/api/registration/register/route.ts",
  "app/api/chat/messages/route.ts",
  "app/api/chat/send/route.ts",
  "app/api/payment/create/route.ts",
];
invariant(
  "all public LIFF token checks bind to the resolved brand channel",
  lineChannelResolver.includes("verifyClinicLiffIdToken") &&
    lineChannelResolver.includes("context.loginChannelId") &&
    liffApiRoutes.every((file) => read(file).includes("verifyClinicLiffIdToken") && !read(file).includes("verifyLiffIdToken(")),
);
invariant(
  "brand LINE mode does not fall back to shared Login or LIFF identifiers",
  lineChannelResolver.includes('connectionMode === "shared" ? sharedLoginChannelId : null') &&
    lineChannelResolver.includes('connectionMode === "shared" ? sharedLiffId : null') &&
    read("lib/useLiff.ts").includes("避免先用全域 ID 初始化到錯誤渠道"),
);
invariant(
  "customer entry contract covers every standard Rich Menu destination",
  ["home", "booking", "appointments", "events", "tickets", "membership", "support", "brand"].every((key) =>
    customerEntryContract.includes(`key: "${key}"`),
  ) && customerEntryContract.includes('url.searchParams.set("clinic_slug"') && customerEntryContract.includes('url.searchParams.set("view"'),
);
invariant(
  "Rich Menu browser targets bypass the LIFF-only shell",
  read("lib/customer-entry.ts").includes('key: "booking", label: "立即預約", accessibilityLabel: "開啟線上預約", browserPath: "/book/browser"') &&
    read("lib/customer-entry.ts").includes('key: "support", label: "LINE 客服", accessibilityLabel: "開啟品牌 LINE 客服", browserPath: "/"') &&
    read("docs/customer-entry-contract.md").includes("| `/book/browser` |"),
);
invariant(
  "embedded browser flows degrade safely when third-party storage is denied",
  read("lib/browser-storage.ts").includes("safeLocalStorageGet") &&
    read("lib/browser-storage.ts").includes("safeLocalStorageSet") &&
    read("app/book/browser/page.tsx").includes("safeLocalStorageGet") &&
    read("app/book/browser/my/page.tsx").includes("safeLocalStorageGet") &&
    read("app/book/browser/reschedule/page.tsx").includes("safeLocalStorageGet") &&
    read("app/my/page.tsx").includes("safeLocalStorageGet") &&
    read("app/book/CustomerEntry.tsx").includes("safeLocalStorageSet"),
);
const appointmentWaitlistSchema = between(
  schema,
  "create table if not exists public.appointment_waitlist_entries",
  "commit;\n\n-- Product restructure M2",
);
invariant(
  "appointment waitlist functions are fully synchronized into consolidated schema",
  appointmentWaitlistSchema.includes("create or replace function public.join_appointment_waitlist") &&
    appointmentWaitlistSchema.includes("create or replace function public.offer_next_appointment_waitlist") &&
    appointmentWaitlistSchema.includes("create or replace function public.accept_appointment_waitlist_offer") &&
    appointmentWaitlistSchema.includes("create or replace function public.cancel_appointment_waitlist") &&
    appointmentWaitlistSchema.includes("create or replace function public.expire_appointment_waitlist_offers") &&
    appointmentWaitlistSchema.includes("create or replace function public.promote_waitlist_after_appointment_cancel") &&
    appointmentWaitlistSchema.includes("for update skip locked") &&
    appointmentWaitlistSchema.includes("pg_advisory_xact_lock") &&
    appointmentWaitlistSchema.includes("grant execute on function public.join_appointment_waitlist") &&
    !schema.includes("appointment-waitlist-functions:"),
);
invariant(
  "appointment waitlist authenticated access is tenant-scoped read-only",
  appointmentWaitlistSchema.includes("revoke all on table public.appointment_waitlist_entries from public, anon, authenticated") &&
    appointmentWaitlistSchema.includes("grant select on table public.appointment_waitlist_entries to authenticated") &&
    appointmentWaitlistSchema.includes("member.clinic_id = appointment_waitlist_entries.clinic_id") &&
    !appointmentWaitlistSchema.includes("grant insert on table public.appointment_waitlist_entries to authenticated") &&
    !appointmentWaitlistSchema.includes("grant update on table public.appointment_waitlist_entries to authenticated") &&
    !appointmentWaitlistSchema.includes("grant delete on table public.appointment_waitlist_entries to authenticated"),
);
invariant(
  "appointment waitlist full targets stay separate from normal availability",
  read("app/api/booking/availability/route.ts").includes("get_appointment_waitlist_targets") &&
    read("app/api/booking/availability/route.ts").includes("waitlist_slots") &&
    read("app/api/booking/availability/route.ts").includes("waitlist_sessions") &&
    migrationAppointmentWaitlistSurfaces.includes("if v_taken >= schedule.capacity or not v_resources_available") &&
    schema.includes("create or replace function public.get_appointment_waitlist_targets"),
);
invariant(
  "appointment waitlist delivery is claimed, retried, and finished atomically",
  migrationAppointmentWaitlistSurfaces.includes("create or replace function public.claim_appointment_waitlist_notifications") &&
    migrationAppointmentWaitlistSurfaces.includes("notification.status = 'claimed'") &&
    migrationAppointmentWaitlistSurfaces.includes("attempt_count < 5") &&
    migrationAppointmentWaitlistSurfaces.includes("create or replace function public.finish_appointment_waitlist_notification") &&
    read("app/api/cron/registration/route.ts").includes("expire_appointment_waitlist_offers") &&
    read("app/api/cron/registration/route.ts").includes("processAppointmentWaitlistNotificationQueue") &&
    read("vercel.json").includes('"schedule": "*/5 * * * *"'),
);
invariant(
  "appointment waitlist customer mutations remain brand and patient scoped",
  read("app/api/booking/waitlist/route.ts").includes('.eq("clinic_id", clinicId)') &&
    read("app/api/booking/waitlist/route.ts").includes("patient.line_user_id !== identity.lineUserId") &&
    read("app/api/booking/waitlist/route.ts").includes("browser.clinicId !== clinicId") &&
    read("app/api/booking/waitlist/route.ts").includes("p_patient_id: patient.id") &&
    read("app/api/booking/waitlist/route.ts").includes("public_booking_enabled"),
);
invariant(
  "waitlist offers cannot masquerade as accepted appointments",
  read("lib/appointment-notifications.ts").includes('appointment?.waitlist_entry_id && String(event.to_status) === "booked"') &&
    read("app/api/booking/my/route.ts").includes("offeredAppointmentIds") &&
    read("app/api/booking/browser/my/route.ts").includes("offeredAppointmentIds") &&
    read("app/api/payment/create/route.ts").includes("請先在我的預約接受候補名額") &&
    read("app/api/booking/cancel/route.ts").includes("請從我的候補取消這筆名額保留") &&
    read("app/api/booking/reschedule/route.ts").includes("請先接受候補名額，再進行改期"),
);
const registrationRlsBlock = between(
  schema,
  "foreach tbl in array array['clinic_domains'",
  "end $$;",
);
invariant(
  "consolidated RLS replay skips tables created later",
  registrationRlsBlock.includes("if to_regclass(format('public.%I', tbl)) is null then") &&
    registrationRlsBlock.includes("continue;")
);
const tableDefinitions = [...schema.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+([a-z0-9_]+)\s*\((.*?)\);/gis)];
invariant(
  "all business tables carry clinic_id",
  tableDefinitions.every((match) => ["clinics", "platform_admins", "api_rate_limit_buckets"].includes(match[1]) || /\bclinic_id\b/i.test(match[2])),
);

const timeBooking = between(schema, "create or replace function book_time_slot", "create or replace function get_available_sessions");
const numberBooking = between(schema, "create or replace function book_number", "-- 後台 authenticated 只能存取自己診所");
const registrationFunction = between(schema, "create or replace function register_for_event", "create or replace function checkin_registration");
const benefitRegistrationFunction = between(schema, "create or replace function register_for_event_with_benefits", "create or replace function apply_registration_benefits");
const registrationApi = read("app/api/registration/register/route.ts");
const registrationEventsApi = read("app/api/registration/events/route.ts");
const bookingReserveApi = read("app/api/booking/reserve/route.ts");
const checkinSearchApi = read("app/api/registration/checkin-search/route.ts");
const adminNav = read("components/AdminNav.tsx");
const adminLayout = read("app/admin/layout.tsx");
const adminDashboard = read("app/admin/dashboard/page.tsx");
const adminSettingsPage = read("app/admin/settings/page.tsx");
const adminLinePage = read("app/admin/line/page.tsx");
const rootLayout = read("app/layout.tsx");
invariant(
  "manual check-in is operator-only and tenant-scoped",
  checkinSearchApi.includes("requireOperator()") &&
    checkinSearchApi.includes('.eq("clinic_id", member.clinicId)') &&
    checkinSearchApi.includes('from("checkins")') &&
    adminNav.includes('href: "/admin/calendar"'),
);
invariant(
  "brand admin navigation is workflow-oriented and module-filtered",
  ["今日工作台", "預約營運", "活動與報名", "顧客與會員", "訊息中心", "報表", "設定中心"].every((label) =>
    adminNav.includes(`label: "${label}"`),
  ) &&
    adminNav.includes("module?: keyof AdminModuleVisibility") &&
    adminNav.includes("modules[item.module]") &&
    adminLayout.includes("events_enabled, memberships_enabled, crm_automation_enabled, line_channel_enabled, legacy_progress_enabled"),
);
invariant(
  "technical LINE routing identifiers have one settings owner",
  !adminSettingsPage.includes('name="line_destination"') &&
    adminLinePage.includes('name="line_destination"') &&
    !between(read("app/admin/settings/actions.ts"), "export async function updateClinicProfileAction", "function brandPageText").includes("line_destination"),
);
invariant(
  "brand settings and team permissions use domain-scoped server action modules",
  read("app/admin/settings/page.tsx").includes('from "./actions"') &&
    read("app/admin/users/page.tsx").includes('from "./actions"') &&
    read("app/admin/settings/actions.ts").startsWith('"use server"') &&
    read("app/admin/users/actions.ts").startsWith('"use server"') &&
    !read("app/admin/actions.ts").includes("export async function updateSettingsAction") &&
    !read("app/admin/actions.ts").includes("export async function resetStaffPasswordAction"),
);
invariant(
  "admin mutations are split by business domain",
  [
    "appointment-actions.ts",
    "schedule-actions.ts",
    "patient-actions.ts",
    "service-actions.ts",
    "line-actions.ts",
  ].every((file) => read(`app/admin/${file}`).startsWith('"use server"')) &&
    read("app/admin/actions.ts").split("\n").length < 150,
);
invariant(
  "admin onboarding is secondary to today's work and uses plain language",
  adminDashboard.indexOf("今日待處理") < adminDashboard.indexOf("<BrandSetupGuide") &&
    adminDashboard.includes("<details className=\"admin-section group") &&
    !adminDashboard.includes("smoke test"),
);
invariant(
  "application typography does not depend on a remote font stylesheet",
  !rootLayout.includes("fonts.googleapis.com") && !rootLayout.includes("fonts.gstatic.com"),
);
invariant(
  "new brand onboarding exposes eight readiness steps and blocking reasons",
  ["1. 品牌資料", "2. 品牌形象頁", "3. 服務／活動", "4. 人員／資源／排班", "5. 預約與報名規則", "6. LINE 官方帳號入口", "7. 通知與付款", "8. 上線前測試"].every((label) =>
    adminDashboard.includes(label),
  ) && adminDashboard.includes('type SetupStatus = "done" | "warning" | "blocked"') &&
    adminDashboard.includes("下一步：") &&
    adminDashboard.includes('status: operationsReady && lineLaunchReady && paymentLaunchReady ? "warning" : "blocked"'),
);
invariant(
  "disabled standard modules hide navigation and reject direct public operations",
  read("lib/admin-modules.ts").includes("isAdminModuleEnabled") &&
    read("components/ModuleDisabled.tsx").includes("此品牌目前未啟用這個標準模組") &&
    read("app/api/registration/register/route.ts").includes("settings.events_enabled !== true") &&
    read("app/api/membership/portal/route.ts").includes("!settings.memberships_enabled") &&
    read("app/api/cron/marketing/route.ts").includes("!settings.crm_automation_enabled") &&
    read("app/api/registration/checkin/route.ts").includes('isAdminModuleEnabled(member.supabase, member.clinicId, "events")'),
);
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
const registrationCredentials = read("lib/registration-credentials.ts");
const adminActions = [
  read("app/admin/actions.ts"),
  read("app/admin/appointment-actions.ts"),
  read("app/admin/line-actions.ts"),
  read("app/admin/patient-actions.ts"),
  read("app/admin/schedule-actions.ts"),
  read("app/admin/service-actions.ts"),
  read("app/admin/settings/actions.ts"),
  read("app/admin/users/actions.ts"),
].join("\n");
const richMenuLibrary = read("lib/richmenu.ts");
const lineLibrary = read("lib/line.ts");
const richMenuAdminPage = read("app/admin/richmenu/page.tsx");
const richMenuPublishForm = read("app/admin/richmenu/PublishForm.tsx");
const richMenuCron = read("app/api/cron/richmenu/route.ts");
const funnelClient = read("lib/funnel-client.ts");
const customerEntryConfigApi = read("app/api/customer/entry-config/route.ts");
const customerPortalApi = read("app/api/customer/portal/route.ts");
const customerEntryView = read("app/book/CustomerEntry.tsx");
const settingsPage = read("app/admin/settings/page.tsx");
const browserStartApi = read("app/api/booking/browser/start/route.ts");
const bookingRescheduleApi = read("app/api/booking/reschedule/route.ts");
const browserMyApi = read("app/api/booking/browser/my/route.ts");
const bookingPage = [
  read("app/book/page.tsx"),
  read("app/book/BookingSteps.tsx"),
  read("app/book/MyAppointments.tsx"),
].join("\n");
const bookingFlowState = read("app/book/booking-flow-state.ts");
const reschedulePage = read("app/book/reschedule/page.tsx");
const browserBookingPage = read("app/book/browser/page.tsx");
const browserMyPage = read("app/book/browser/my/page.tsx");
const browserReschedulePage = read("app/book/browser/reschedule/page.tsx");
const bookingConfigApi = read("app/api/booking/config/route.ts");
const brandComponent = read("components/Brand.tsx");
const reminderCron = read("app/api/cron/reminders/route.ts");
const lineWebhook = [
  read("app/api/line/webhook/route.ts"),
  read("lib/line-webhook-messages.ts"),
  read("lib/line-webhook-reply.ts"),
  read("lib/line-webhook-status.ts"),
].join("\n");
const bookingPageSource = read("app/book/page.tsx");
const publicBrand = read("lib/public-brand.ts");
const homePage = read("app/page.tsx");
const marketingHome = read("components/MarketingHome.tsx");
const marketingLayout = read("components/MarketingLayout.tsx");
const productPage = read("app/product/page.tsx");
const solutionsPage = read("app/solutions/page.tsx");
const pricingPage = read("app/pricing/page.tsx");
const contactPage = read("app/contact/page.tsx");
const registrationPage = read("app/register/page.tsx");
const registrationCancelApi = read("app/api/registration/cancel/route.ts");
const registrationCancelPage = read("app/register/cancel/page.tsx");
const publicPatientFunction = between(schema, "create or replace function create_or_get_public_patient", "revoke all on function create_or_get_public_patient");
const saveRichMenuAction = between(adminActions, "export async function saveRichMenuAction", "export async function publishRichMenuAction");
const publishRichMenuAction = between(adminActions, "export async function publishRichMenuAction", "export async function unpublishRichMenuAction");
const rollbackRichMenuAction = between(adminActions, "export async function rollbackRichMenuVersionAction", "export async function updateLineConfigAction");

invariant(
  "Rich Menu presets are module-aware and accessible",
  ["booking:", "events:", "mixed:"].every((key) => richMenuLibrary.includes(key)) &&
    richMenuLibrary.includes("accessibilityLabel") &&
    richMenuLibrary.includes("validateRichMenuSlots") &&
    richMenuLibrary.includes("自訂連結必須使用 HTTPS") &&
    richMenuLibrary.includes("不可使用已停用的舊版服務進度"),
);
invariant(
  "Rich Menu saved-draft preview overlays click areas and exposes per-slot targets",
  richMenuPublishForm.includes("customerEntryUrl") &&
    richMenuPublishForm.includes("gridTemplateColumns") &&
    richMenuPublishForm.includes("背景與點擊區預覽") &&
    richMenuPublishForm.includes("逐格連結測試") &&
    richMenuPublishForm.includes("瀏覽器測試") &&
    richMenuPublishForm.includes("lineTarget !== browserTarget") &&
    richMenuPublishForm.includes("href={lineTarget}") &&
    richMenuPublishForm.includes('target="_blank"') &&
    richMenuAdminPage.includes("previewClinicSlug") &&
    richMenuAdminPage.includes("previewLiffId"),
);
invariant(
  "Rich Menu save, publish, and rollback are separate recoverable operations",
  saveRichMenuAction.includes('rpc("create_line_richmenu_version"') &&
    !saveRichMenuAction.includes("buildAndPublishRichMenu") &&
    publishRichMenuAction.includes('rpc("record_line_richmenu_publication"') &&
    publishRichMenuAction.includes("if (oldId) await setDefaultRichMenu") &&
    publishRichMenuAction.includes("await deleteRichMenu(newId") &&
    rollbackRichMenuAction.includes('p_kind: "rolled_back"'),
);
invariant(
  "Rich Menu image content and exact dimensions are validated before publication",
  publishRichMenuAction.includes("file.size > 1024 * 1024") &&
    adminActions.includes("圖片內容必須是 PNG 或 JPEG") &&
    publishRichMenuAction.includes("image.width !== spec.width || image.height !== spec.height") &&
    publishRichMenuAction.indexOf("inspectRichMenuImage") < publishRichMenuAction.indexOf("buildAndPublishRichMenu"),
);
invariant(
  "existing Rich Menu configurations are backfilled as version one",
  migrationProductModulesLineRichMenu.includes("insert into public.line_richmenu_versions") &&
    migrationProductModulesLineRichMenu.includes("'既有 Rich Menu'") &&
    migrationProductModulesLineRichMenu.includes("published_version_id = case") &&
    schema.includes("'既有 Rich Menu'"),
);
invariant(
  "Rich Menu second-batch schema is synchronized and tenant-bound",
  [
    "create table if not exists public.line_richmenu_aliases",
    "create table if not exists public.line_richmenu_schedules",
    "create or replace function public.clone_line_richmenu_version",
    "create or replace function public.claim_due_line_richmenu_schedules",
    "create or replace function public.finish_line_richmenu_schedule",
  ].every((token) => migrationRichMenuOptimization.includes(token) && schema.includes(token)) &&
    migrationRichMenuOptimization.includes("foreign key (clinic_id, version_id)") &&
    migrationRichMenuOptimization.includes("line_richmenu_versions_source_tenant_fkey") &&
    migrationRichMenuOptimization.includes("revoke all on table public.line_richmenu_aliases from public, anon, authenticated") &&
    migrationRichMenuOptimization.includes("revoke all on table public.line_richmenu_schedules from public, anon, authenticated") &&
    migrationRichMenuOptimization.includes("for select to authenticated") &&
    !migrationRichMenuOptimization.includes("grant insert on table public.line_richmenu_aliases") &&
    !migrationRichMenuOptimization.includes("grant insert on table public.line_richmenu_schedules") &&
    !schema.includes("\\ir migrations/202608110004_richmenu_optimization.sql"),
);
invariant(
  "Rich Menu Alias actions validate tenant ownership and compensate remote writes",
  lineLibrary.includes("getRichMenuAlias") &&
    lineLibrary.includes("createRichMenuAlias") &&
    lineLibrary.includes("updateRichMenuAlias") &&
  lineLibrary.includes("deleteRichMenuAlias") &&
    migrationRichMenuOptimization.includes("line_richmenu_aliases_channel_alias_uidx") &&
    migrationRichMenuOptimization.includes("on public.line_richmenu_aliases (channel_destination, alias_id)") &&
    migrationRichMenuOptimization.includes("where status <> 'removed'") &&
    adminActions.includes("channel_destination: context.destination") &&
    adminActions.includes("此選單頁籤代碼已由同一 LINE 渠道的其他品牌使用") &&
    adminActions.includes("且不屬於本品牌") &&
    adminActions.includes('.eq("clinic_id", clinicId)') &&
    adminActions.includes("if (remoteBefore) await updateRichMenuAlias") &&
    adminActions.includes("else await deleteRichMenuAlias") &&
    richMenuAdminPage.includes("LINE 將這個捷徑稱為 Alias") &&
    richMenuAdminPage.includes("syncRichMenuAliasAction"),
);
invariant(
  "Rich Menu tab actions use official alias switches and LINE label limits",
  richMenuLibrary.includes('case "richmenuswitch"') &&
    richMenuLibrary.includes('type: "richmenuswitch"') &&
    richMenuLibrary.includes("richMenuAliasId: slot.value") &&
    richMenuLibrary.includes("無障礙標籤不可超過 20 字") &&
    read("app/admin/richmenu/RichMenuEditor.tsx").includes("maxLength={20}"),
);
invariant(
  "Rich Menu schedules are retryable, authenticated, and auditable",
  migrationRichMenuOptimization.includes("for update of schedule skip locked") &&
  migrationRichMenuOptimization.includes("attempt_count < 5") &&
    migrationRichMenuOptimization.includes("display window ended before activation") &&
    migrationRichMenuOptimization.includes("service role required") &&
    migrationRichMenuOptimization.includes("manual publication superseded this schedule") &&
    richMenuCron.includes("CRON_SECRET") &&
    richMenuCron.includes('rpc("claim_due_line_richmenu_schedules"') &&
    richMenuCron.includes('rpc("finish_line_richmenu_schedule"') &&
    read("vercel.json").includes('"path": "/api/cron/richmenu"') &&
    read("scripts/trigger-reminders.mjs").includes('"richmenu", richMenuTarget'),
);
invariant(
  "Rich Menu versions can be cloned and compared without mutating the source",
  adminActions.includes('rpc("clone_line_richmenu_version"') &&
    richMenuAdminPage.includes("versionDifferences") &&
    richMenuAdminPage.includes("複製為新草稿") &&
    migrationRichMenuOptimization.includes("source_version_id"),
);
invariant(
  "Rich Menu insights join official clicks to privacy-safe platform conversions",
  lineLibrary.includes("getRichMenuInsightSummary") &&
    lineLibrary.includes("/insight/richmenu/") &&
    funnelClient.includes("enrichedMetadata.rm_version") &&
    funnelClient.includes("enrichedMetadata.rm_slot") &&
    bookingPage.includes('trackFunnelEvent("booking_success"') &&
    customerEntryView.includes('["utm_source", "rm_version", "rm_slot"]') &&
    richMenuAdminPage.includes('.eq("source", "richmenu")') &&
    richMenuAdminPage.includes('metadata->>rm_version') &&
    richMenuAdminPage.includes("不含姓名、電話或 LINE 使用者識別碼"),
);
invariant(
  "one LIFF entry routes every standard customer task",
  ["home", "booking", "appointments", "events", "tickets", "membership", "support", "brand"].every((view) =>
    bookingPageSource.includes(`\"${view}\"`) && customerEntryContract.includes(`key: \"${view}\"`),
  ) &&
    bookingPageSource.includes('api<EntryConfig>("/api/customer/entry-config")') &&
    bookingPageSource.includes('params.get("view")') &&
    customerEntryConfigApi.includes("getClinicLineChannelContext"),
);
invariant(
  "LIFF portal identity stays brand and patient scoped",
  customerPortalApi.includes("verifyClinicLiffIdToken") &&
    customerPortalApi.includes('.eq("clinic_id", clinicId)') &&
    customerPortalApi.includes('.eq("line_user_id", lineUserId)') &&
    customerPortalApi.includes('patients.find((patient) => patient.id === requestedPatientId)') &&
    customerPortalApi.includes("createBrowserBookingToken(clinicId, patientId)") &&
    customerPortalApi.includes("decryptRegistrationToken(encrypted)"),
);
invariant(
  "unified customer portal respects module switches and limits QR credentials",
  customerPortalApi.includes("settings.events_enabled === true") &&
    customerPortalApi.includes("settings.memberships_enabled === true") &&
    customerPortalApi.includes('["confirmed", "attended"].includes(String(registration.status))') &&
    customerPortalApi.includes('registration.payment_status !== "pending"') &&
    customerEntryConfigApi.includes('line.verificationStatus === "ready"'),
);
invariant(
  "paused acquisition does not hide existing appointments or tickets",
  customerEntryContract.includes('key: "appointments"') &&
    customerEntryContract.includes('liffView: "appointments", requires: "always"') &&
    customerEntryContract.includes('liffView: "tickets", requires: "tickets"') &&
    richMenuLibrary.includes('slot.action === "tickets"') &&
    richMenuLibrary.includes("availability.tickets"),
);
invariant(
  "LINE activity registration preserves verified LIFF identity",
  registrationPage.includes('useLiff(liffRequested ? liffId : undefined)') &&
    registrationPage.includes('idToken: idToken || undefined') &&
    registrationPage.includes('(liffRequested && !liffReady)') &&
    customerEntryView.includes('liff: "1"'),
);

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
    read("app/book/page.tsx").includes("visit_type: visitType") &&
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
    read("app/admin/line-actions.ts").includes("getRichMenuLineContext") &&
    read("app/admin/line-actions.ts").includes("clinicSlug") &&
    lineWebhook.includes("liffUrl(liffId, clinicSlug)") &&
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
    bookingReserveApi.includes('const metadataPatch: { source: "online"; service_id?: string; booking_answers?: Record<string, unknown>; booking_form_snapshot?: unknown[] }') &&
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
  "registration links the customer identity transactionally",
  schema.includes("p_patient_id uuid default null") &&
    schema.includes("set terms_version = p_terms_version") &&
    schema.includes("patient_id = p_patient_id") &&
    migrationRegistrationPatient.includes("patient_id = p_patient_id") &&
    migrationRegistrationPatient.includes("grant execute on function public.register_for_event_with_terms") &&
    registrationApi.includes("p_patient_id: patientRow.patient_id") &&
    !registrationApi.includes("patientLinkError"),
);
invariant(
  "registration SQL qualifies identifiers and keeps the date prefix out of the numeric sequence",
  [registrationFunction, migrationRegistration, benefitRegistrationFunction, migrationBenefits, migrationRegistrationNumberFix].every(
    (source) =>
      source.includes("substring(r.registration_no from '([0-9]+)$')") &&
      source.includes("::bigint") &&
      source.includes("registrations r") &&
      source.includes("greatest(4"),
  ) &&
    schema.includes("if exists (select 1 from checkins c where c.registration_id") &&
    migrationRegistration.includes("if exists (select 1 from checkins c where c.registration_id"),
);
invariant(
  "benefit registration branches avoid uninitialized records",
  [benefitRegistrationFunction, migrationBenefits].every(
    (source) =>
      source.includes("v_discount_code_id uuid") &&
      source.includes("v_membership_id uuid") &&
      source.includes("v_discount_code_id") &&
      source.includes("v_membership_id") &&
      source.includes("plan_service_id"),
  ),
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
  "appointment payment failure restores benefits atomically",
    paymentWebhook.includes('rpc("fail_appointment_payment"') &&
    schema.includes("create or replace function fail_appointment_payment") &&
    migrationBenefits.includes("create or replace function fail_appointment_payment") &&
    schema.includes("perform restore_membership_credit(p_clinic_id, appt.membership_id, 'appointment', appt.id, p_note)") &&
    schema.includes("perform fail_appointment_payment(a.clinic_id, a.id, 'appointment deposit expired')") &&
    migrationBenefits.includes("perform fail_appointment_payment(a.clinic_id, a.id, 'appointment deposit expired')") &&
    schema.includes("grant execute on function fail_appointment_payment(uuid, uuid, text) to service_role"),
);
invariant(
  "payment webhooks stay bound to the verified merchant brand",
  paymentWebhook.includes('.eq("clinic_id", event.clinicId)') &&
    paymentReturnApi.includes("clinicId: settings.clinic_id") &&
    paymentEcpayApi.includes("clinicId: settings.clinic_id") &&
    paymentNewebpayApi.includes("clinicId: settings.clinic_id") &&
    paymentReturnApi.includes("notifyRegistrationForPayment(svc, settings.clinic_id") &&
    paymentReturnApi.includes("notifyAppointmentForPayment(svc, settings.clinic_id"),
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
    lineWebhook.includes("notifyAppointmentStatus") &&
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
  "notification queues do not starve older status events",
  schema.includes("notification_processed_at timestamptz") &&
    migrationHardening.includes("add column if not exists notification_processed_at") &&
    schema.includes("appointment_status_events_notification_queue_idx") &&
    schema.includes("registration_status_events_notification_queue_idx") &&
    appointmentNotifications.includes('.is("notification_processed_at", null)') &&
    registrationNotifications.includes('.is("notification_processed_at", null)') &&
    appointmentNotifications.includes("created_at.gt.") &&
    registrationNotifications.includes("created_at.gt.") &&
    appointmentNotifications.includes("markAppointmentStatusEventProcessed") &&
    registrationNotifications.includes("markRegistrationStatusEventProcessed"),
);
invariant(
  "waitlist promotion preserves ticket type capacity",
  schema.includes("left join event_ticket_types tt") &&
    migrationHardening.includes("left join event_ticket_types tt") &&
    schema.includes("r.ticket_capacity") &&
    migrationHardening.includes("r.ticket_capacity") &&
    schema.includes("active_reg.ticket_type_id = r.ticket_type_id") &&
    migrationHardening.includes("active_reg.ticket_type_id = r.ticket_type_id"),
);
invariant(
  "deposit payments have a public flow and expiry release path",
  read("app/api/payment/create/route.ts").includes("verifyBrowserBookingToken") &&
    read("app/api/payment/create/route.ts").includes("verifyClinicLiffIdToken") &&
    schema.includes("deposit_expires_at") &&
    schema.includes("expire_pending_appointment_deposits") &&
    read("app/api/cron/registration/route.ts").includes("expire_pending_appointment_deposits"),
);
invariant(
  "public payment return paths stay on the branded flow",
  paymentCreateApi.includes("safeReturnPath") &&
    paymentCreateApi.includes("return_path") &&
    paymentCreateApi.includes("process.env.APP_URL") &&
    !paymentCreateApi.includes("x-forwarded-host") &&
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
  bookingRescheduleApi.includes('verifyClinicLiffIdToken') &&
    bookingRescheduleApi.includes('verifyBrowserBookingToken') &&
    bookingRescheduleApi.includes('rpc("reschedule_service_appointment"') &&
    bookingRescheduleApi.includes('notifyAppointmentStatus') &&
    bookingRescheduleApi.includes('recordCrmInteraction') &&
    bookingPage.includes("openReschedule") &&
    reschedulePage.includes('/api/booking/reschedule') &&
    reschedulePage.includes('/api/payment/create') &&
    reschedulePage.includes('!url.startsWith("/api/payment/create")') &&
    browserBookingPage.includes('safeLocalStorageSet([[browserTokenKey(), value]') &&
    browserBookingPage.includes('const clinicId = source.get("clinic_id")?.trim()') &&
    browserMyPage.includes('/api/booking/browser/my') &&
    browserMyPage.includes('/book/browser/reschedule') &&
    browserReschedulePage.includes('browser_token: token'),
);
invariant(
  "customer reschedule supports service-only bookings",
  bookingRescheduleApi.includes('rpc("reschedule_service_appointment"') &&
    bookingRescheduleApi.includes("if (!body.doctor_id && !serviceId)") &&
    browserReschedulePage.includes("providerRequired") &&
    reschedulePage.includes("providerRequired"),
);
invariant(
  "customer booking steps use one explicit derived flow state",
  bookingPageSource.includes('getBookingFlowState({') &&
    bookingPageSource.includes('data-booking-stage={bookingFlow.stage}') &&
    bookingPageSource.includes('disabled={!bookingFlow.canSubmit}') &&
    bookingFlowState.includes('"identifying_customer"') &&
    bookingFlowState.includes('"choosing_customer"') &&
    bookingFlowState.includes('"customer_details"') &&
    bookingFlowState.includes('"service_details"') &&
    bookingFlowState.includes('"choosing_time"') &&
    bookingFlowState.includes('submitBlock === null') &&
    bookingPageSource.includes("<BookingCustomerStep") &&
    bookingPageSource.includes("<BookingServiceStep") &&
    bookingPageSource.includes("<BookingTimeStep"),
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
  "marketing homepage stays separate from branded customer portals",
  homePage.includes("if (!clinicId) return <MarketingHome />") &&
    homePage.includes("resolvePublicClinicIdFromScope") &&
    marketingHome.includes("LINE Rich Menu") &&
    marketingHome.includes("LIFF") &&
    marketingHome.includes("CRM Lite") &&
    marketingHome.includes("多品牌資料隔離") &&
    marketingHome.includes("70 項標準功能完整開放") &&
    marketingLayout.includes("07-9721612") &&
    !marketingLayout.includes("07-9721612#888") &&
    marketingLayout.includes("https://lin.ee/jnAfCBy") &&
    marketingLayout.includes("@xinhow") &&
    marketingLayout.includes("service@xinhow.com.tw") &&
    contactPage.includes("service@xinhow.com.tw"),
);
invariant(
  "marketing visuals show customer workflows rather than internal platform controls",
    marketingHome.includes("DashboardMockup") &&
    !marketingHome.includes("PlatformPreview") &&
    !marketingHome.includes("平台與品牌分層") &&
    !marketingHome.includes("平台擁有者") &&
    !marketingHome.includes("平台層") &&
    !productPage.includes("系統擁有者") &&
    !productPage.includes("平台層") &&
    marketingLayout.includes("export function ModuleInterface") &&
    marketingLayout.includes("export function JourneyDiagram"),
);
invariant(
  "marketing inner pages include relevant intro visuals",
  [productPage, solutionsPage, pricingPage, contactPage].every((page) => page.includes("visual={<PageIntroVisual")) &&
    marketingLayout.includes("type IntroVisualVariant") &&
    marketingLayout.includes("variant === \"solutions\"") &&
    marketingLayout.includes("variant === \"pricing\"") &&
    marketingLayout.includes("OnboardingStep"),
);
invariant(
  "marketing pages include real scene photography",
  marketingHome.includes("/marketing/hero-service-counter.png") &&
    productPage.includes("/marketing/product-schedule-team.png") &&
    solutionsPage.includes("/marketing/solutions-event-checkin.png") &&
    pricingPage.includes("/marketing/pricing-scope-planning.png") &&
    contactPage.includes("/marketing/contact-onboarding.png") &&
    exists("public/marketing/hero-service-counter.png") &&
    exists("public/marketing/product-schedule-team.png") &&
    exists("public/marketing/solutions-event-checkin.png") &&
    exists("public/marketing/pricing-scope-planning.png") &&
    exists("public/marketing/contact-onboarding.png"),
);
invariant(
  "marketing pricing has confirmed plan and add-on prices",
  pricingPage.includes("39,800") &&
    pricingPage.includes("2,500") &&
    pricingPage.includes("15,000 起") &&
    pricingPage.includes("30,000 起") &&
    pricingPage.includes("評估後報價"),
);
invariant(
  "multi-page branded marketing site exists",
  marketingLayout.includes("/brand/xinhao-horizontal.png") &&
    marketingLayout.includes("/brand/xinhao-gold-dark.png") &&
    exists("app/product/page.tsx") &&
    exists("app/solutions/page.tsx") &&
    exists("app/pricing/page.tsx") &&
    exists("app/contact/page.tsx") &&
    marketingLayout.includes("href=\"/product\"") &&
    marketingLayout.includes("href=\"/solutions\"") &&
    marketingLayout.includes("href=\"/pricing\"") &&
    marketingLayout.includes("href=\"/contact\""),
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
  "public appointment captures optional email within verified identity scope",
  bookingReserveApi.includes("email?: string") &&
    bookingReserveApi.includes("Email 格式不正確") &&
    bookingReserveApi.includes('.update({ email })') &&
    bookingReserveApi.includes('eq("clinic_id", clinicId)') &&
    bookingPage.includes('name="email"') &&
    browserBookingPage.includes('type="email"') &&
    read("app/api/booking/patients-of-line/route.ts").includes("email")
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
  "registration marketing consent synchronizes to the tenant CRM patient",
  schema.includes("create or replace function create_or_get_public_patient_with_marketing_opt_in") &&
    migrationMarketingOptIn.includes("marketing_opt_in = true") &&
    registrationApi.includes("create_or_get_public_patient_with_marketing_opt_in") &&
    registrationApi.includes("p_marketing_opt_in: body.marketing_opt_in === true") &&
    schema.includes("grant execute on function create_or_get_public_patient_with_marketing_opt_in") &&
    migrationMarketingOptIn.includes("grant execute on function create_or_get_public_patient_with_marketing_opt_in") &&
    stagingRunbook.includes("migration_marketing_opt_in_sync.sql"),
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
  "calendar export validates ranges and escapes line breaks",
  read("lib/calendar.ts").includes("invalid calendar range") &&
    read("lib/calendar.ts").includes("replace(/\\r\\n|\\r|\\n/g") &&
    read("app/api/booking/ics/route.ts").includes("invalid calendar range") &&
    read("app/api/booking/ics/route.ts").includes("slice(0, 2000)"),
);
invariant(
  "admin image uploads validate content signatures and use cryptographic keys",
  read("app/api/admin/upload/route.ts").includes("matchesImageSignature") &&
    read("app/api/admin/upload/route.ts").includes("randomBytes(16)") &&
    read("app/api/admin/upload/route.ts").includes("檔案內容與圖片格式不符"),
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
  "marketing automation skips blocked customers with an audit reason",
  marketingCron.includes("blocked_until") && marketingCron.includes("顧客目前被封鎖") &&
    read("app/admin/crm/page.tsx").includes('const canEdit = role === "owner" || role === "admin"') &&
    read("app/admin/crm/page.tsx").includes("{canEdit ? (") &&
    read("app/admin/crm/page.tsx").includes("{canEdit && (")
);
invariant(
  "CRM Lite admin can update and preview automations",
  read("app/admin/crm/actions.ts").includes("export async function updateAutomationAction") &&
    read("app/admin/crm/page.tsx").includes("updateAutomationAction") &&
    read("app/admin/crm/page.tsx").includes("預覽與編輯") &&
    read("lib/crm.ts").includes("previewAutomationTemplate")
);
invariant(
  "CRM segments link to a tenant-scoped customer list",
  read("app/admin/crm/page.tsx").includes("segment_id=") &&
    read("app/admin/patients/page.tsx").includes("crm_segment_members") &&
    read("app/admin/patients/page.tsx").includes('.eq("clinic_id", clinicId)')
);
invariant(
  "funnel events are anonymous and tenant-scoped",
  migrationFunnel.includes("anonymous_id text not null") &&
    migrationFunnel.includes("clinic_id uuid not null references public.clinics") &&
    migrationFunnel.includes("revoke all on table public.funnel_events") &&
    read("app/api/analytics/funnel/route.ts").includes("metadata") &&
    read("app/admin/reports/page.tsx").includes("顧客漏斗事件"),
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
  "LINE confirmation cannot overwrite a concurrent cancellation",
  lineWebhook.includes('.update({ status: newStatus })') &&
    lineWebhook.includes('.in("status", ["booked", "confirmed"])'),
);
invariant(
  "LINE confirmation cannot bypass pending deposits",
  lineWebhook.includes("deposit_status") &&
    lineWebhook.includes('if (action === "confirm" && appt.deposit_status === "pending")'),
);
invariant(
  "admin errors hide raw provider messages and keep a traceable identifier",
  read("app/admin/error.tsx").includes("錯誤識別碼") &&
    read("app/admin/error.tsx").includes("error.digest") &&
    !read("app/admin/error.tsx").includes("{error.message}"),
);
invariant(
  "admin login does not expose authentication provider errors",
  read("app/admin/login/page.tsx").includes("登入服務目前無法使用") &&
    read("app/admin/login/page.tsx").includes("目前無法連線至登入服務") &&
    !read("app/admin/login/page.tsx").includes("登入失敗:${reason}") &&
    !read("app/admin/login/page.tsx").includes("無法連線至驗證伺服器:"),
);
invariant(
  "Rich Menu operator errors hide provider details and keep a lookup id",
  read("app/admin/line-actions.ts").includes("redirectRichMenuFailure") &&
    read("app/admin/line-actions.ts").includes("錯誤識別碼") &&
    read("app/admin/richmenu/page.tsx").includes("目前無法讀取成效資料") &&
    !read("app/admin/line-actions.ts").includes("err=${encodeURIComponent(error.message"),
);
invariant(
  "admin status updates cannot resurrect terminal appointments",
  adminActions.includes('.update({ status })') &&
    adminActions.includes('.in("status", ["booked", "confirmed"])'),
);
invariant(
  "admin cancellation uses the atomic benefit-restoring RPC",
  schema.includes("create or replace function cancel_appointment_by_operator") &&
    migrationBenefits.includes("create or replace function cancel_appointment_by_operator") &&
    schema.includes("cm.clinic_id = p_clinic_id") &&
    schema.includes("and cm.user_id = p_actor_user_id") &&
    schema.includes("and cm.role <> 'provider'") &&
    schema.includes("set_config('request.jwt.claim.sub', p_actor_user_id::text, true)") &&
    schema.includes("grant execute on function cancel_appointment_by_operator(uuid, uuid, uuid, text) to service_role") &&
    adminActions.includes('rpc("cancel_appointment_by_operator"') &&
    adminActions.includes('p_actor_user_id: user.id'),
);
invariant(
  "staff password reset is tenant-bound and brand-admin-protected",
  adminActions.includes('export async function resetStaffPasswordAction') &&
    adminActions.includes('.from("clinic_members")') &&
    adminActions.includes('.eq("clinic_id", clinicId)') &&
    adminActions.includes('.eq("user_id", userId)') &&
    adminActions.includes('target.access_type === "brand_admin"') &&
    adminActions.includes("requireBrandAdmin"),
);
invariant(
  "serving numbers bind to an active doctor in the same clinic",
  adminActions.includes('export async function advanceServingAction') &&
    adminActions.includes('export async function setQueueAutoAction') &&
    adminActions.includes('.eq("id", doctorId)') &&
    adminActions.includes('.eq("clinic_id", clinicId)') &&
    adminActions.includes('.eq("active", true)') &&
    schema.includes('d.id = serving_numbers.doctor_id') &&
    schema.includes('d.clinic_id = serving_numbers.clinic_id') &&
    migrationRoleMatrix.includes('d.id = serving_numbers.doctor_id') &&
    migrationRoleMatrix.includes('d.clinic_id = serving_numbers.clinic_id'),
);
invariant(
  "schedule writes bind to active doctors in the same clinic",
  adminActions.includes('export async function createTemplateAction') &&
    adminActions.includes('export async function updateTemplateAction') &&
    adminActions.includes('export async function createExceptionAction') &&
    adminActions.includes('.from("doctors")') &&
    schema.includes('d.id = schedule_templates.doctor_id') &&
    schema.includes('d.clinic_id = schedule_templates.clinic_id') &&
    schema.includes('d.id = schedule_exceptions.doctor_id') &&
    schema.includes('d.clinic_id = schedule_exceptions.clinic_id') &&
    migrationRoleMatrix.includes('d.id = schedule_templates.doctor_id') &&
    migrationRoleMatrix.includes('d.id = schedule_exceptions.doctor_id'),
);
invariant(
  "doctor assignments bind both doctor and provider to the same clinic",
  schema.includes("target.role = 'provider'") &&
    schema.includes("d.id = doctor_assignments.doctor_id") &&
    schema.includes("d.clinic_id = doctor_assignments.clinic_id") &&
    migrationHardening.includes("target.role = 'provider'") &&
    migrationHardening.includes("d.id = doctor_assignments.doctor_id"),
);
invariant(
  "authenticated child writes bind referenced records to the same clinic",
  schema.includes("d.clinic_id = appointments.clinic_id") &&
    schema.includes("p.clinic_id = appointments.clinic_id") &&
    schema.includes("s.clinic_id = appointments.clinic_id") &&
    schema.includes("p.clinic_id = patient_records.clinic_id") &&
    schema.includes("p.clinic_id = crm_interactions.clinic_id") &&
    schema.includes("e.clinic_id = event_sessions.clinic_id") &&
    schema.includes("e.clinic_id = event_ticket_types.clinic_id") &&
    schema.includes("f.clinic_id = registration_form_fields.clinic_id") &&
    schema.includes("s.clinic_id = membership_plans.clinic_id") &&
    schema.includes("s.clinic_id = crm_segment_members.clinic_id") &&
    migrationRoleMatrix.includes("d.clinic_id = appointments.clinic_id") &&
    migrationRoleMatrix.includes("p.clinic_id = appointments.clinic_id") &&
    migrationRoleMatrix.includes("e.clinic_id = event_sessions.clinic_id") &&
    migrationRoleMatrix.includes("f.clinic_id = registration_form_fields.clinic_id"),
);
invariant(
  "CRM timeline failures do not retry delivered marketing messages",
  marketingCron.includes('await markDelivery(svc, claim, "sent", null);') &&
    marketingCron.includes('await recordCrmInteraction(svc, {') &&
    marketingCron.includes('}).catch((error: unknown) => console.error("CRM campaign interaction failed", error));'),
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
    registrationApi.includes("if (!settings)") &&
    registrationApi.includes('.eq("clinic_id", clinicId)') &&
    registrationApi.includes('.eq("clinic_id", event.clinic_id)') &&
    registrationDetailApi.includes('.eq("clinic_id", clinicId)') &&
    registrationDetailApi.includes('eq("clinic_id", event.clinic_id)') &&
    registrationDetailApi.includes("if (!settings)") &&
    registrationEventsApi.includes("const now = Date.now()") &&
    registrationEventsApi.includes("registration_open_at") &&
    registrationEventsApi.includes("registration_close_at") &&
    registrationEventsApi.includes("if (!settings)") &&
    paymentCreateApi.includes("if (!publicSettings)"),
);
invariant(
  "public registration cancellation preserves and verifies tenant scope",
  homePage.includes("/register/cancel${clinicScopeSuffix}") &&
    registrationCancelPage.includes("scopeSuffix") &&
    registrationCancelPage.includes("/api/registration/cancel${scopeSuffix}") &&
    registrationCancelApi.includes("resolvePublicClinicId") &&
    registrationCancelApi.includes('.eq("clinic_id", clinicId)') &&
    registrationCancelApi.includes("p_clinic_id: clinicId"),
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
    read("lib/public-brand.ts").includes('.eq("id", configuredClinicId)') &&
    read("lib/public-brand.ts").includes("configuredClinic?.id") &&
    read("lib/public-brand.ts").includes("isSharedHost") &&
    read("lib/public-brand.ts").includes("if (host && !isSharedHost(host))") &&
    read("app/api/line/webhook/route.ts").includes("brand destination not configured"),
);
invariant(
  "shared platform hosts resolve tenant slugs before custom-domain records",
  read("lib/public-brand.ts").includes("if (host && !isSharedHost(host))") &&
    read("lib/public-brand.ts").indexOf("if (host && !isSharedHost(host))") < read("lib/public-brand.ts").indexOf('from("clinic_domains")'),
);
invariant(
  "public tenant resolution does not trust spoofable forwarded host headers",
  !read("lib/public-brand.ts").includes("x-forwarded-host") &&
    read("lib/public-brand.ts").includes('req.headers.get("host")'),
);
invariant(
  "public payment creation respects the registration publish switch",
  paymentCreateApi.includes("public_registration_enabled") && paymentCreateApi.includes("目前暫停公開報名付款"),
);
invariant(
  "registration payment creation verifies branded tenant scope",
  paymentCreateApi.includes("const publicClinicId = await resolvePublicClinicId(req, svc)") &&
    paymentCreateApi.includes('.eq("clinic_id", publicClinicId)') &&
    registrationPage.includes("/api/payment/create${paymentScope}"),
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
const brandFunction = between(migrationTwoLevelAdminPermissions, "create or replace function public.create_brand_with_owner", "revoke all on function public.create_brand_with_owner");
invariant(
  "new brand creation is atomic, brand-admin-scoped, and seeds settings",
  brandFunction.includes("access_type = 'brand_admin'") &&
    brandFunction.includes("insert into public.clinic_settings") &&
    brandFunction.includes("insert into public.clinic_members") &&
    brandFunction.includes("'brand_admin'") &&
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
  "provider access is assignment-scoped and brand management identity is protected",
  schema.includes("create table if not exists doctor_assignments") &&
    migrationHardening.includes("create table if not exists doctor_assignments") &&
    schema.includes("doctor_assignments_self") &&
    read("lib/admin.ts").includes("getAssignedDoctorIds") &&
    read("app/admin/page.tsx").includes("assignedDoctorIds") &&
    read("app/admin/dashboard/page.tsx").includes("assignedDoctorIds") &&
    read("app/admin/queue/page.tsx").includes("assignedDoctorIds") &&
    adminActions.includes('target.access_type === "brand_admin"') &&
    adminActions.includes("至少要保留一位品牌管理者") &&
    adminActions.includes("requireBrandAdmin"),
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
    adminActions.includes('rpc("reschedule_service_appointment"'),
);
invariant(
  "appointment cancellation restores benefits atomically across entry points",
  schema.includes("create or replace function cancel_appointment") &&
    migrationBenefits.includes("create or replace function cancel_appointment") &&
    adminActions.includes('rpc("cancel_appointment"') &&
    read("app/api/booking/cancel/route.ts").includes('rpc("cancel_appointment"') &&
    lineWebhook.includes('rpc("cancel_appointment"'),
);
invariant(
  "consolidated schema creates membership tables before dependent functions",
  schema.indexOf("create table if not exists membership_plans") >= 0 &&
    schema.indexOf("create table if not exists patient_memberships") > schema.indexOf("create table if not exists membership_plans") &&
    schema.indexOf("create or replace function grant_patient_membership") > schema.indexOf("create table if not exists membership_ledger"),
);
invariant(
  "benefits are transaction-safe and reversible",
  migrationBenefits.includes("pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text))") &&
    migrationBenefits.includes("create or replace function consume_membership_credit") &&
    migrationBenefits.includes("create or replace function restore_membership_credit") &&
    migrationBenefits.includes("create or replace function release_registration_benefits") &&
    migrationBenefits.includes("create or replace function apply_registration_benefits"),
);
invariant(
  "registration and waitlist capacity share one tenant event lock",
  schema.includes("hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text))") &&
    migrationRegistration.includes("hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text))") &&
    migrationBenefits.includes("hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text))") &&
    migrationHardening.includes("hashtext('registration-event:' || p_clinic_id::text || ':' || s.event_id::text))") &&
    !migrationBenefits.includes("registration-benefit:") &&
    !migrationHardening.includes("registration-session:"),
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
  (registrationApi.includes("register_for_event_with_benefits") || registrationApi.includes("register_for_event_with_terms")) &&
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
  "registration no-show is an operator-only post-session transition",
  read("app/admin/registrations/actions.ts").includes("markRegistrationNoShowAction") &&
    read("app/admin/registrations/actions.ts").includes('registration.status !== "confirmed"') &&
    read("app/admin/registrations/actions.ts").includes("場次尚未開始，不能標記為未到") &&
    read("app/admin/registrations/page.tsx").includes("markRegistrationNoShowAction"),
);

invariant(
  "paid waitlist promotion has a resumable payment entry point",
  read("lib/registration-notifications.ts").includes("publicRegistrationPaymentUrl") &&
    read("lib/registration-notifications.ts").includes("/register/pay") &&
    read("app/register/pay/page.tsx").includes("/api/payment/create") &&
    read("app/register/pay/page.tsx").includes("checkin_token"),
);

invariant(
  "registration notification retries can recover a credential without plaintext storage",
  schema.includes("checkin_token_encrypted text") &&
    exists("supabase/migration_registration_credentials.sql") &&
    registrationApi.includes("encryptRegistrationToken") &&
    registrationNotifications.includes("decryptRegistrationToken") &&
    registrationNotifications.includes("checkin_token_encrypted") &&
    registrationCredentials.includes("aes-256-gcm") &&
    registrationCredentials.includes("REGISTRATION_TOKEN_ENCRYPTION_KEY"),
);
invariant(
  "registration custom form answers are validated server-side by field type",
  read("app/api/registration/register/route.ts").includes('field.field_type === "checkbox" && value === false') &&
    read("app/api/registration/register/route.ts").includes('typeof value !== "boolean"') &&
    read("app/api/registration/register/route.ts").includes('field.field_type === "date"') &&
    read("app/api/registration/register/route.ts").includes('field.field_type === "select"'),
);
invariant(
  "benefits are manageable from the protected admin surface",
  exists("app/admin/memberships/page.tsx") &&
    exists("app/admin/memberships/actions.ts") &&
    read("components/AdminNav.tsx").includes("/admin/memberships"),
);
invariant(
  "role matrix is synchronized and narrows authenticated RLS",
  schema.includes("clinic_settings_manage") &&
    schema.includes("serving_member") &&
    migrationRoleMatrix.includes("clinic_settings_manage") &&
    migrationRoleMatrix.includes("serving_member") &&
    migrationRoleMatrix.includes("line_replies_member") &&
    migrationRoleMatrix.includes("crm_interactions_insert") &&
    migrationRoleMatrix.includes("appointments_provider_status_update") &&
    migrationRoleMatrix.includes("role in ('owner','admin')") &&
    migrationRoleMatrix.includes("role in ('owner','admin','frontdesk','staff')"),
);
invariant(
  "security advisor hardening fixes mutable trigger paths and public RPC grants",
  read("supabase/schema.sql").includes("language plpgsql set search_path = ''") &&
    read("supabase/schema.sql").includes("revoke all on function get_available_sessions(uuid,uuid,date) from public, anon, authenticated") &&
    read("supabase/schema.sql").includes("revoke all on function record_registration_status_event() from public, anon, authenticated") &&
    exists("supabase/migration_security_advisor_hardening.sql"),
);
invariant(
  "LINE UI catalog covers the complete customer journey",
  exists("app/admin/line-templates/page.tsx") &&
    read("components/AdminNav.tsx").includes("/admin/line-templates") &&
    ["welcome", "service_hub", "booking_confirmed", "payment_pending", "appointment_reminder", "appointment_changed", "waitlist_joined", "waitlist_offer", "quick_rebook", "registration_confirmed", "ticket_ready", "membership_balance", "campaign", "support_handoff"]
      .every((key) => read("lib/line-ui-templates.ts").includes(`key: "${key}"`)),
);
invariant(
  "Rich Menu built-in artwork is authenticated and produces LINE-sized PNG",
  read("app/api/admin/richmenu-template/route.ts").includes("requireAdmin") &&
    read("app/api/admin/richmenu-template/route.ts").includes("renderRichMenuPng") &&
    read("lib/richmenu-art.ts").includes("sharp(Buffer.from(svg)).png") &&
    read("lib/richmenu.ts").includes("width: 2500, height: 1686") &&
    read("lib/richmenu.ts").includes("width: 2500, height: 843") &&
    read("app/admin/richmenu/PublishForm.tsx").includes("套用內建圖稿") &&
    read("app/admin/richmenu/PublishForm.tsx").includes("下載 PNG"),
);
invariant(
  "course learning tables and tenant policies are synchronized",
  schema.includes("create table if not exists course_units") &&
    schema.includes("create table if not exists course_unit_progress") &&
    migrationCourseLearning.includes("alter table public.course_units enable row level security") &&
    migrationCourseLearning.includes("revoke all on table public.course_units from public, anon"),
);
invariant(
  "beauty inventory movements are atomic and private photos are never public",
  schema.includes("create or replace function public.record_inventory_movement") &&
    schema.includes("for update") &&
    migrationBeautyOperations.includes("beauty_operations_enabled") &&
    migrationBeautyOperations.includes("grant execute on function public.record_inventory_movement") &&
    read("app/api/admin/beauty-photo/route.ts").includes("public: false") &&
    !read("app/api/admin/beauty-photo/route.ts").includes("getPublicUrl"),
);
invariant(
  "industry pack writes stay server mediated and scheduled states use Taipei time",
  migrationIndustryPacks.includes("grant execute on function public.receive_purchase_order") &&
  migrationIndustryPacks.includes("grant execute on function public.freeze_patient_subscription") &&
    migrationIndustryPacks.includes("now() at time zone 'Asia/Taipei'") &&
    migrationIndustryPacks.includes("paused_subscription boolean not null default false") &&
    migrationIndustryPacks.includes("f.paused_subscription") &&
    read("app/admin/beauty/supply/actions.ts").includes("requireOperator") &&
    read("app/admin/fitness/actions.ts").includes("requireOperator") &&
    read("app/admin/documents/actions.ts").includes("randomBytes(32)") &&
    read("app/sign/[token]/actions.ts").includes('eq("status", "pending")'),
);
invariant(
  "course answers stay server-only and completion issues a certificate",
  migrationIndustryPacks.includes("create table if not exists public.course_assessment_submissions") &&
    migrationIndustryPacks.includes("issue_course_certificate_if_complete") &&
    read("app/api/customer/learning/route.ts").includes('select("id,unit_id,kind,prompt,options,correct_option,passing_score")') &&
    read("app/api/customer/learning/route.ts").includes("correct_option?:number|null") &&
    !read("app/learn/page.tsx").includes("correct_option") &&
    read("app/admin/course-content/actions.ts").includes("reviewCourseAssignmentAction"),
);
invariant(
  "appointment and waitlist LINE status notifications use task-focused Flex cards",
  read("lib/appointment-notifications.ts").includes("buildAppointmentStatusFlex") &&
    read("lib/appointment-waitlist-notifications.ts").includes("buildWaitlistStatusFlex") &&
    read("lib/registration-notifications.ts").includes("buildRegistrationStatusFlex") &&
    read("lib/line-ui-templates.ts").includes('type: "flex"') &&
    read("lib/line-ui-templates.ts").includes('view: "appointments"') === false,
);

if (failures.length > 0) {
  console.error(`\nContract verification failed: ${failures.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log("\nContract verification passed.");
}
