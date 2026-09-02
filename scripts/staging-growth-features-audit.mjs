import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const environment = process.env.RAILWAY_ENVIRONMENT_NAME ?? "";
if (!url || !serviceKey) throw new Error("缺少 Supabase staging 環境變數");
if (environment.toLowerCase() !== "staging") throw new Error(`僅允許 staging；目前為 ${environment || "unknown"}`);

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const clinicIds = [];
let userId = null;
let failed = false;

function pass(message) { console.log(`[PASS] ${message}`); }
function fail(message) { failed = true; console.error(`[FAIL] ${message}`); }
function assert(message, value) { value ? pass(message) : fail(message); }
async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function taipeiDatePlus(days) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + days * 86_400_000));
}
function weekday(date) { return new Date(`${date}T12:00:00+08:00`).getUTCDay(); }

async function cleanupClinics(ids) {
  const errors = [];
  async function remove(table) {
    const { error } = await db.from(table).delete().in("clinic_id", ids);
    if (error) errors.push(`${table}: ${error.message}`);
  }
  for (const table of [
    "appointment_notification_logs", "appointment_status_events", "reminder_logs", "crm_interactions",
    "appointments", "appointment_series", "schedule_exceptions", "schedule_templates", "service_addons",
    "service_resource_assignments", "service_resources", "doctors", "patient_records", "patients", "services",
    "data_import_jobs", "channel_test_runs", "admin_product_events", "handoff_tasks", "feature_interest_signals",
    "trial_brand_observations", "clinic_activation_metrics", "clinic_members", "clinic_line_channels",
    "brand_entitlements", "clinic_settings",
  ]) await remove(table);
  const { error: clinicError } = await db.from("clinics").delete().in("id", ids);
  if (clinicError) errors.push(`clinics: ${clinicError.message}`);
  if (errors.length) throw new Error(errors.join("; "));
}

async function cleanup() {
  const errors = [];
  if (clinicIds.length) {
    try { await cleanupClinics(clinicIds); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (userId) {
    await db.from("platform_admins").delete().eq("user_id", userId);
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) errors.push(`auth user: ${error.message}`);
  }
  if (errors.length) throw new Error(errors.join("; "));
}

try {
  const stale = await must("find stale clinics", db.from("clinics").select("id").like("slug", "qa-growth-%"));
  if ((stale ?? []).length) {
    await cleanupClinics(stale.map((row) => row.id));
    pass(`已清理 ${stale.length} 個中斷的 growth QA 品牌`);
  }

  const auth = await db.auth.admin.createUser({
    email: `qa-growth-${suffix}@example.invalid`,
    password: `${randomBytes(18).toString("base64url")}!Aa1`,
    email_confirm: true,
  });
  if (auth.error || !auth.data.user) throw new Error(`create auth user: ${auth.error?.message ?? "missing user"}`);
  userId = auth.data.user.id;

  const clinics = await must("create clinics", db.from("clinics").insert(Array.from({ length: 4 }, (_, index) => ({
    name: `QA Growth Brand ${index + 1}`,
    slug: `qa-growth-${index + 1}-${suffix}`,
    active: true,
  }))).select("id"));
  clinicIds.push(...clinics.map((row) => row.id));
  const clinicId = clinicIds[0];
  await must("create brand admin", db.from("clinic_members").insert({
    clinic_id: clinicId, user_id: userId, role: "admin", access_type: "brand_admin",
    permissions: ["brand.manage", "operations.manage"],
  }));
  await must("create system admin", db.from("platform_admins").insert({
    user_id: userId, role: "admin", access_type: "system_admin", permissions: [], active: true,
  }));
  await must("configure recurring booking", db.from("clinic_settings").update({
    booking_mode: "time", min_lead_minutes: 0, max_advance_days: 90,
    public_booking_enabled: true, recurring_booking_enabled: true,
    max_recurring_occurrences: 4, deposit_enabled: false,
  }).eq("clinic_id", clinicId));

  const importRows = [
    { name: "匯入顧客一", phone: "0911000001", birthday: "1990-01-01", marketing_opt_in: false },
    { name: "匯入顧客二", phone: "0911000002", birthday: "1992-02-02", marketing_opt_in: true },
  ];
  const importKey = `qa_growth_${suffix.replaceAll("-", "_")}`;
  const firstJob = await must("execute patient import", db.rpc("execute_data_import", {
    p_clinic_id: clinicId, p_actor_user_id: userId, p_entity: "patients", p_idempotency_key: importKey, p_rows: importRows,
  }));
  const replayJob = await must("replay patient import", db.rpc("execute_data_import", {
    p_clinic_id: clinicId, p_actor_user_id: userId, p_entity: "patients", p_idempotency_key: importKey, p_rows: importRows,
  }));
  const job = await must("read import job", db.from("data_import_jobs").select("status,total_rows,imported_rows,failed_rows").eq("id", firstJob).single());
  const importedPatients = await must("read imported patients", db.from("patients").select("id,name").eq("clinic_id", clinicId));
  assert("CSV 匯入保存逐列結果且同一 idempotency key 不重複匯入", firstJob === replayJob && job.status === "completed" && job.imported_rows === 2 && job.failed_rows === 0 && importedPatients.length === 2);

  const doctor = await must("create provider", db.from("doctors").insert({ clinic_id: clinicId, name: "QA Growth Provider", active: true }).select("id").single());
  const service = await must("create service", db.from("services").insert({
    clinic_id: clinicId, name: "QA Growth Service", active: true, booking_target: "provider_required",
    duration_minutes: 30, buffer_minutes: 0,
  }).select("id").single());
  const addon = await must("create add-on", db.from("service_addons").insert({
    clinic_id: clinicId, service_id: service.id, name: "QA 20-minute add-on", duration_minutes: 20, price: 300, active: true,
  }).select("id").single());
  const date = taipeiDatePlus(7);
  await must("create weekly schedule", db.from("schedule_templates").insert({
    clinic_id: clinicId, doctor_id: doctor.id, service_id: service.id, weekday: weekday(date),
    start_time: "09:00", end_time: "12:00", slot_minutes: 30, capacity: 1, active: true,
  }));
  const slots = await must("read add-on availability", db.rpc("get_available_service_slots_with_options", {
    p_clinic_id: clinicId, p_service_id: service.id, p_date: date, p_visit_type: "return",
    p_doctor_id: doctor.id, p_addon_ids: [addon.id],
  }));
  assert("加購時段查詢把 20 分鐘加到 30 分鐘基本服務", slots.length > 0 && new Date(slots[0].slot_end).getTime() - new Date(slots[0].slot_start).getTime() === 50 * 60_000);

  const start = `${date}T09:00:00+08:00`;
  const recurring = await must("book recurring series", db.rpc("book_recurring_appointments", {
    p_clinic_id: clinicId, p_service_id: service.id, p_doctor_id: doctor.id,
    p_patient_id: importedPatients[0].id, p_start_at: start, p_template_id: null, p_date: null,
    p_visit_type: "return", p_is_self_pay: false, p_membership_code: null,
    p_booking_answers: {}, p_booking_form_snapshot: [], p_addon_ids: [addon.id],
    p_occurrence_count: 3, p_interval_weeks: 1,
  }));
  const ids = recurring.map((row) => row.appointment_id);
  const appointments = await must("read recurring appointments", db.from("appointments").select("id,series_id,series_sequence,start_at,end_at,addons_amount,addons_snapshot").in("id", ids).order("series_sequence"));
  assert("週期預約一次建立三週且每筆保留加購快照與獨立序號", appointments.length === 3 && appointments.every((row, index) => row.series_id && row.series_sequence === index + 1 && row.addons_amount === 300 && Array.isArray(row.addons_snapshot) && row.addons_snapshot.length === 1 && new Date(row.end_at).getTime() - new Date(row.start_at).getTime() === 50 * 60_000));

  const seriesBefore = await must("count series before failed race", db.from("appointment_series").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId));
  const failedSeries = await db.rpc("book_recurring_appointments", {
    p_clinic_id: clinicId, p_service_id: service.id, p_doctor_id: doctor.id,
    p_patient_id: importedPatients[1].id, p_start_at: start, p_template_id: null, p_date: null,
    p_visit_type: "return", p_is_self_pay: false, p_membership_code: null,
    p_booking_answers: {}, p_booking_form_snapshot: [], p_addon_ids: [addon.id],
    p_occurrence_count: 3, p_interval_weeks: 1,
  });
  const seriesAfter = await must("count series after failed race", db.from("appointment_series").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId));
  assert("任一週額滿時整組週期預約回滾", Boolean(failedSeries.error) && seriesBefore === null && seriesAfter === null);
  const { count: seriesCount } = await db.from("appointment_series").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId);
  assert("失敗的週期預約沒有留下第二個系列", seriesCount === 1);

  for (const observedClinicId of clinicIds.slice(0, 3)) {
    await must("start trial observation", db.rpc("start_trial_brand_observation", { p_actor_user_id: userId, p_clinic_id: observedClinicId, p_notes: "QA atomic limit" }));
  }
  const fourth = await db.rpc("start_trial_brand_observation", { p_actor_user_id: userId, p_clinic_id: clinicIds[3], p_notes: "must fail" });
  const observations = await must("read trial observations", db.from("trial_brand_observations").select("id").in("clinic_id", clinicIds).eq("status", "active"));
  assert("三品牌觀察上限以資料庫鎖原子限制", observations.length === 3 && Boolean(fourth.error));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try { await cleanup(); pass("Growth QA 品牌、資料與 Auth 帳號已清理"); }
  catch (error) { fail(`清理失敗：${error instanceof Error ? error.message : String(error)}`); }
}

if (failed) process.exitCode = 1;
else console.log("Staging growth features audit passed.");
