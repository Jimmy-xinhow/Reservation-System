import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "";
if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("缺少 Supabase staging 環境變數");
if (environmentName.toLowerCase() !== "staging") throw new Error(`僅允許 staging；目前環境為 ${environmentName || "unknown"}`);

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const qaSlug = `qa-booking-${suffix}`;
const qaEmail = `qa-provider-${suffix}@example.invalid`;
const qaPassword = `${randomBytes(18).toString("base64url")}!Aa1`;
let clinicId = null;
let providerUserId = null;
let failed = false;

function pass(message) { console.log(`[PASS] ${message}`); }
function fail(message) { failed = true; console.error(`[FAIL] ${message}`); }
function assert(message, condition) { condition ? pass(message) : fail(message); }
async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function taipeiDatePlus(days) {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);
}
function weekday(date) { return new Date(`${date}T12:00:00+08:00`).getUTCDay(); }
function appointmentIdFromNumberRpc(data) { return Array.isArray(data) ? data[0]?.appointment_id : null; }

async function concurrentBookings(label, first, second) {
  const results = await Promise.all([first(), second()]);
  const successes = results.filter((result) => !result.error);
  const failures = results.filter((result) => result.error);
  assert(`${label} 最後一個名額只有一個請求成功`, successes.length === 1 && failures.length === 1);
  if (successes.length !== 1) {
    throw new Error(`${label}: ${results.map((result) => result.error?.message ?? "success").join(" | ")}`);
  }
  return { success: successes[0], loserIndex: results[0].error ? 0 : 1 };
}

async function cleanupClinic(targetClinicId) {
  const errors = [];
  async function remove(label, promise) {
    const { error } = await promise;
    if (error) errors.push(`${label}: ${error.message}`);
  }
  if (targetClinicId) {
    await remove("unlink appointment waitlist", service.from("appointments").update({ waitlist_entry_id: null }).eq("clinic_id", targetClinicId));
    await remove("unlink waitlist appointment", service.from("appointment_waitlist_entries")
      .update({ status: "cancelled", appointment_id: null, offer_expires_at: null }).eq("clinic_id", targetClinicId));
    for (const table of [
      "appointment_waitlist_notification_logs",
      "appointment_waitlist_events",
      "appointment_notification_logs",
      "appointment_status_events",
      "reminder_logs",
      "payment_status_events",
      "payment_transactions",
      "payment_orders",
      "appointment_waitlist_entries",
      "appointments",
      "doctor_assignments",
      "schedule_exceptions",
      "schedule_templates",
      "service_resource_assignments",
      "service_resources",
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
  }
  if (errors.length) throw new Error(errors.join("; "));
}

async function cleanup() {
  const errors = [];
  if (clinicId) {
    try { await cleanupClinic(clinicId); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (providerUserId) {
    const { error } = await service.auth.admin.deleteUser(providerUserId);
    if (error) errors.push(`provider auth user: ${error.message}`);
  }
  if (errors.length) throw new Error(errors.join("; "));
}

try {
  const staleClinics = await must("find stale QA clinics", service.from("clinics").select("id").like("slug", "qa-booking-%"));
  for (const staleClinic of staleClinics ?? []) await cleanupClinic(staleClinic.id);
  if ((staleClinics ?? []).length > 0) pass(`已清理 ${staleClinics.length} 個先前中斷的 QA 預約租戶`);

  const clinic = await must("create clinic", service.from("clinics").insert({
    name: "QA Booking Lifecycle",
    slug: qaSlug,
    active: true,
  }).select("id").single());
  clinicId = clinic.id;
  await must("configure time mode", service.from("clinic_settings").update({
    booking_mode: "time",
    min_lead_minutes: 0,
    max_advance_days: 60,
    first_visit_extends: true,
    first_visit_minutes: 45,
    deposit_enabled: false,
  }).eq("clinic_id", clinicId));

  const doctors = await must("create providers", service.from("doctors").insert([
    { clinic_id: clinicId, name: "QA Provider A", active: true },
    { clinic_id: clinicId, name: "QA Provider B", active: true },
  ]).select("id"));
  const [doctorA, doctorB] = doctors;
  const serviceRow = await must("create service", service.from("services").insert({
    clinic_id: clinicId,
    name: "QA Service",
    active: true,
    booking_target: "provider_required",
    duration_minutes: 30,
    buffer_minutes: 0,
  }).select("id").single());
  const patients = await must("create patients", service.from("patients").insert([
    { clinic_id: clinicId, name: "QA Customer 1", phone: "0900000001" },
    { clinic_id: clinicId, name: "QA Customer 2", phone: "0900000002" },
    { clinic_id: clinicId, name: "QA Resource Customer 1", phone: "0900000003" },
    { clinic_id: clinicId, name: "QA Resource Customer 2", phone: "0900000004" },
    { clinic_id: clinicId, name: "QA Flexible Customer", phone: "0900000005" },
  ]).select("id"));

  const timeDate = taipeiDatePlus(7);
  const numberDate = taipeiDatePlus(8);
  const timeTemplate = await must("create time template", service.from("schedule_templates").insert({
    clinic_id: clinicId, doctor_id: doctorA.id, service_id: serviceRow.id,
    weekday: weekday(timeDate), start_time: "10:00", end_time: "12:00",
    slot_minutes: 30, capacity: 1, active: true,
  }).select("id").single());
  const timeStart = `${timeDate}T10:00:00+08:00`;
  const timeResult = await concurrentBookings(
    "時間制併發競爭",
    () => service.rpc("book_time_slot_for_service", {
      p_clinic_id: clinicId, p_doctor_id: doctorA.id, p_patient_id: patients[0].id,
      p_start_at: timeStart, p_visit_type: "first", p_is_self_pay: false, p_service_id: serviceRow.id,
    }),
    () => service.rpc("book_time_slot_for_service", {
      p_clinic_id: clinicId, p_doctor_id: doctorA.id, p_patient_id: patients[1].id,
      p_start_at: timeStart, p_visit_type: "first", p_is_self_pay: false, p_service_id: serviceRow.id,
    }),
  );
  const timeWinnerId = timeResult.success.data;
  const timeWaitPatient = patients[timeResult.loserIndex].id;
  const timeWinner = await must("read time booking", service.from("appointments").select("start_at,end_at").eq("id", timeWinnerId).single());
  assert("首次服務延長為 45 分鐘", new Date(timeWinner.end_at).getTime() - new Date(timeWinner.start_at).getTime() === 45 * 60_000);

  const timeWait = await must("join time waitlist", service.rpc("join_appointment_waitlist", {
    p_clinic_id: clinicId, p_patient_id: timeWaitPatient, p_booking_mode: "time",
    p_doctor_id: doctorA.id, p_service_id: serviceRow.id, p_requested_start_at: timeStart,
    p_requested_date: timeDate, p_visit_type: "first", p_is_self_pay: false,
    p_booking_answers: {}, p_source: "online",
  }));
  const timeWaitId = timeWait[0]?.waitlist_id;
  assert("時間制額滿後可加入候補第 1 位", Boolean(timeWaitId) && timeWait[0]?.waitlist_position === 1);
  await must("cancel time winner", service.rpc("cancel_appointment", {
    p_clinic_id: clinicId, p_appointment_id: timeWinnerId, p_note: "QA lifecycle",
  }));
  const timeOffered = await must("read time offer", service.from("appointment_waitlist_entries")
    .select("status,appointment_id,offer_expires_at").eq("id", timeWaitId).single());
  assert("時間制取消後原子遞補並保留名額", timeOffered.status === "offered" && Boolean(timeOffered.appointment_id) && Boolean(timeOffered.offer_expires_at));
  const acceptedTimeId = await must("accept time offer", service.rpc("accept_appointment_waitlist_offer", {
    p_clinic_id: clinicId, p_waitlist_id: timeWaitId, p_patient_id: timeWaitPatient,
  }));
  const acceptedTime = await must("verify time accepted", service.from("appointment_waitlist_entries").select("status").eq("id", timeWaitId).single());
  assert("時間制候補接受後轉為正式預約", acceptedTime.status === "booked" && acceptedTimeId === timeOffered.appointment_id);

  await must("switch number mode", service.from("clinic_settings").update({ booking_mode: "number" }).eq("clinic_id", clinicId));
  const numberTemplate = await must("create number template", service.from("schedule_templates").insert({
    clinic_id: clinicId, doctor_id: doctorB.id, service_id: serviceRow.id,
    weekday: weekday(numberDate), start_time: "14:00", end_time: "15:00",
    slot_minutes: 30, capacity: 1, active: true,
  }).select("id").single());
  const numberResult = await concurrentBookings(
    "場次制併發競爭",
    () => service.rpc("book_number_for_service", {
      p_clinic_id: clinicId, p_doctor_id: doctorB.id, p_patient_id: patients[0].id,
      p_template_id: numberTemplate.id, p_date: numberDate, p_visit_type: "return",
      p_is_self_pay: false, p_service_id: serviceRow.id,
    }),
    () => service.rpc("book_number_for_service", {
      p_clinic_id: clinicId, p_doctor_id: doctorB.id, p_patient_id: patients[1].id,
      p_template_id: numberTemplate.id, p_date: numberDate, p_visit_type: "return",
      p_is_self_pay: false, p_service_id: serviceRow.id,
    }),
  );
  const numberWinnerId = appointmentIdFromNumberRpc(numberResult.success.data);
  const numberWaitPatient = patients[numberResult.loserIndex].id;
  const numberWait = await must("join number waitlist", service.rpc("join_appointment_waitlist", {
    p_clinic_id: clinicId, p_patient_id: numberWaitPatient, p_booking_mode: "number",
    p_doctor_id: doctorB.id, p_service_id: serviceRow.id, p_template_id: numberTemplate.id,
    p_requested_date: numberDate, p_requested_start_at: null, p_visit_type: "return",
    p_is_self_pay: false, p_booking_answers: {}, p_source: "online",
  }));
  const numberWaitId = numberWait[0]?.waitlist_id;
  assert("場次制額滿後可加入候補第 1 位", Boolean(numberWaitId) && numberWait[0]?.waitlist_position === 1);
  await must("cancel number winner", service.rpc("cancel_appointment", {
    p_clinic_id: clinicId, p_appointment_id: numberWinnerId, p_note: "QA lifecycle",
  }));
  const numberOffered = await must("read number offer", service.from("appointment_waitlist_entries")
    .select("status,appointment_id,offer_expires_at").eq("id", numberWaitId).single());
  assert("場次制取消後原子遞補並保留名額", numberOffered.status === "offered" && Boolean(numberOffered.appointment_id));
  const acceptedNumberId = await must("accept number offer", service.rpc("accept_appointment_waitlist_offer", {
    p_clinic_id: clinicId, p_waitlist_id: numberWaitId, p_patient_id: numberWaitPatient,
  }));
  const acceptedNumber = await must("verify number accepted", service.from("appointment_waitlist_entries").select("status").eq("id", numberWaitId).single());
  assert("場次制候補接受後轉為正式預約", acceptedNumber.status === "booked" && acceptedNumberId === numberOffered.appointment_id);

  const resourceDate = taipeiDatePlus(9);
  const resource = await must("create shared resource", service.from("service_resources").insert({
    clinic_id: clinicId, name: "QA Shared Room", kind: "room", capacity: 1, active: true,
  }).select("id").single());
  const resourceServices = await must("create resource-only services", service.from("services").insert([
    {
      clinic_id: clinicId, name: "QA Resource Service A", active: true,
      booking_target: "resource_only", duration_minutes: 30, buffer_minutes: 0,
    },
    {
      clinic_id: clinicId, name: "QA Resource Service B", active: true,
      booking_target: "resource_only", duration_minutes: 30, buffer_minutes: 0,
    },
  ]).select("id,name"));
  await must("assign shared resource", service.from("service_resource_assignments").insert(resourceServices.map((row) => ({
    clinic_id: clinicId, service_id: row.id, resource_id: resource.id, quantity: 1,
  }))));
  await must("create resource-only schedules", service.from("schedule_templates").insert(resourceServices.map((row) => ({
    clinic_id: clinicId, doctor_id: null, service_id: row.id, weekday: weekday(resourceDate),
    start_time: "10:00", end_time: "12:00", slot_minutes: 30, capacity: 2, active: true,
  }))));
  const resourceStart = `${resourceDate}T10:00:00+08:00`;
  const resourceRace = await Promise.all([
    service.rpc("book_service_slot", {
      p_clinic_id: clinicId, p_service_id: resourceServices[0].id, p_patient_id: patients[2].id,
      p_start_at: resourceStart, p_visit_type: "return", p_is_self_pay: false, p_booking_answers: {},
    }),
    service.rpc("book_service_slot", {
      p_clinic_id: clinicId, p_service_id: resourceServices[1].id, p_patient_id: patients[3].id,
      p_start_at: resourceStart, p_visit_type: "return", p_is_self_pay: false, p_booking_answers: {},
    }),
  ]);
  const resourceSuccesses = resourceRace.filter((result) => !result.error);
  assert("跨服務共用資源容量仍維持原子性", resourceSuccesses.length === 1);
  if (resourceSuccesses.length !== 1) {
    console.error(`[INFO] shared resource race: ${resourceRace.map((result) => result.error?.message ?? "success").join(" | ")}`);
  }

  const flexibleDate = taipeiDatePlus(10);
  const flexibleService = await must("create provider-optional service", service.from("services").insert({
    clinic_id: clinicId, name: "QA Flexible Service", active: true,
    booking_target: "provider_optional", duration_minutes: 30, buffer_minutes: 0,
    booking_fields: [{ key: "note", label: "Note", type: "text", required: false }],
  }).select("id").single());
  await must("create provider-optional schedule", service.from("schedule_templates").insert({
    clinic_id: clinicId, doctor_id: null, service_id: flexibleService.id, weekday: weekday(flexibleDate),
    start_time: "09:00", end_time: "12:00", slot_minutes: 30, capacity: 1, active: true,
  }));
  const originalFlexibleId = await must("book provider-optional service without a provider", service.rpc("book_service_slot", {
    p_clinic_id: clinicId, p_service_id: flexibleService.id, p_patient_id: patients[4].id,
    p_start_at: `${flexibleDate}T09:00:00+08:00`, p_visit_type: "return", p_is_self_pay: false,
    p_booking_answers: { note: "preserve me" },
  }));
  const rescheduledFlexibleId = await must("reschedule provider-optional service", service.rpc("reschedule_service_appointment", {
    p_clinic_id: clinicId, p_old_appointment_id: originalFlexibleId, p_mode: "time",
    p_doctor_id: null, p_service_id: flexibleService.id, p_start_at: `${flexibleDate}T10:00:00+08:00`,
    p_template_id: null, p_date: null,
  }));
  const flexibleRows = await must("verify service-only reschedule", service.from("appointments")
    .select("id,status,doctor_id,service_id,start_at,booking_answers").in("id", [originalFlexibleId, rescheduledFlexibleId]));
  const oldFlexible = flexibleRows.find((row) => row.id === originalFlexibleId);
  const newFlexible = flexibleRows.find((row) => row.id === rescheduledFlexibleId);
  assert("免指定人員服務改期維持交易原子性與答案快照", oldFlexible?.status === "cancelled" &&
    newFlexible?.status === "booked" && newFlexible?.doctor_id === null && newFlexible?.service_id === flexibleService.id &&
    newFlexible?.booking_answers?.note === "preserve me");
  const failedReschedule = await service.rpc("reschedule_service_appointment", {
    p_clinic_id: clinicId, p_old_appointment_id: rescheduledFlexibleId, p_mode: "time",
    p_doctor_id: null, p_service_id: flexibleService.id, p_start_at: `${flexibleDate}T13:00:00+08:00`,
    p_template_id: null, p_date: null,
  });
  const afterFailedReschedule = await must("verify failed reschedule rollback", service.from("appointments")
    .select("status").eq("id", rescheduledFlexibleId).single());
  assert("失敗的免指定人員改期會回滾舊預約取消", Boolean(failedReschedule.error) && afterFailedReschedule.status === "booked");

  const depositDate = taipeiDatePlus(11);
  await must("enable required deposits", service.from("clinic_settings").update({
    booking_mode: "time", deposit_enabled: true, deposit_amount: 200, deposit_scope: "all",
  }).eq("clinic_id", clinicId));
  await must("create deposit schedule", service.from("schedule_templates").insert({
    clinic_id: clinicId, doctor_id: doctorA.id, service_id: serviceRow.id,
    weekday: weekday(depositDate), start_time: "15:00", end_time: "17:00",
    slot_minutes: 30, capacity: 1, active: true,
  }));
  const depositAppointmentId = await must("book appointment requiring deposit", service.rpc("book_time_slot_for_service", {
    p_clinic_id: clinicId, p_doctor_id: doctorA.id, p_patient_id: patients[2].id,
    p_start_at: `${depositDate}T15:00:00+08:00`, p_visit_type: "return",
    p_is_self_pay: false, p_service_id: serviceRow.id,
  }));
  const depositBeforeExpiry = await must("read pending appointment deposit", service.from("appointments")
    .select("status,deposit_status,deposit_amount,deposit_expires_at").eq("id", depositAppointmentId).single());
  assert("預約訂金會進入限時待付款狀態", depositBeforeExpiry.status === "booked" &&
    depositBeforeExpiry.deposit_status === "pending" && depositBeforeExpiry.deposit_amount === 200 && Boolean(depositBeforeExpiry.deposit_expires_at));
  const depositOrder = await must("create pending appointment payment order", service.from("payment_orders").insert({
    clinic_id: clinicId, appointment_id: depositAppointmentId, provider: "ecpay",
    merchant_order_no: `QADEP${Date.now()}`, amount: 200, expires_at: new Date(Date.now() - 60_000).toISOString(),
    return_path: "/book", status: "pending",
  }).select("id").single());
  await must("force appointment deposit expiry", service.from("appointments").update({
    deposit_expires_at: new Date(Date.now() - 60_000).toISOString(),
  }).eq("id", depositAppointmentId));
  const expiredDepositCount = await must("expire pending appointment deposits", service.rpc("expire_pending_appointment_deposits"));
  const expiredDeposit = await must("read expired appointment deposit", service.from("appointments")
    .select("status,deposit_status,deposit_expires_at").eq("id", depositAppointmentId).single());
  const expiredDepositOrder = await must("read expired appointment payment order", service.from("payment_orders")
    .select("status").eq("id", depositOrder.id).single());
  const depositStatusEvent = await must("read appointment deposit status event", service.from("payment_status_events")
    .select("from_status,to_status,source").eq("payment_order_id", depositOrder.id).single());
  assert("逾時訂金會取消預約並將訂單冪等標記為 expired", expiredDepositCount >= 1 &&
    expiredDeposit.status === "cancelled" && expiredDeposit.deposit_status === "failed" && expiredDeposit.deposit_expires_at === null &&
    expiredDepositOrder.status === "expired" && depositStatusEvent.from_status === "pending" &&
    depositStatusEvent.to_status === "expired" && depositStatusEvent.source === "appointment_deposit_expiry");

  const createdUser = await service.auth.admin.createUser({ email: qaEmail, password: qaPassword, email_confirm: true });
  if (createdUser.error || !createdUser.data.user) throw new Error(`create provider auth: ${createdUser.error?.message ?? "missing user"}`);
  providerUserId = createdUser.data.user.id;
  await must("create provider member", service.from("clinic_members").insert({
    clinic_id: clinicId, user_id: providerUserId, role: "provider", access_type: "employee", permissions: ["provider.assigned"],
  }));
  await must("assign provider", service.from("doctor_assignments").insert({
    clinic_id: clinicId, doctor_id: doctorA.id, user_id: providerUserId, active: true,
  }));
  const provider = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await provider.auth.signInWithPassword({ email: qaEmail, password: qaPassword });
  if (signIn.error) throw new Error(`provider sign in: ${signIn.error.message}`);
  const { data: providerRows, error: providerReadError } = await provider.from("appointments")
    .select("id,doctor_id").in("id", [acceptedTimeId, acceptedNumberId]);
  assert("服務提供者只讀到被指派人員的預約", !providerReadError && providerRows?.length === 1 && providerRows[0]?.doctor_id === doctorA.id);
  const { data: forbiddenUpdate, error: forbiddenError } = await provider.from("appointments")
    .update({ status: "done" }).eq("id", acceptedNumberId).select("id");
  const numberAfterForbidden = await must("verify unassigned unchanged", service.from("appointments").select("status").eq("id", acceptedNumberId).single());
  assert("服務提供者不可更新未指派人員的預約", (Boolean(forbiddenError) || forbiddenUpdate?.length === 0) && numberAfterForbidden.status === "booked");
  if (forbiddenError) console.error(`[INFO] 未指派更新由資料庫拒絕: ${forbiddenError.message}`);
  const { data: ownUpdate, error: ownError } = await provider.from("appointments")
    .update({ status: "done" }).eq("id", acceptedTimeId).select("id,status");
  assert("服務提供者可將被指派預約標記完成", !ownError && ownUpdate?.length === 1 && ownUpdate[0]?.status === "done");
  if (ownError) console.error(`[INFO] 已指派更新錯誤: ${ownError.message}`);
  await provider.auth.signOut();

  const history = await must("read waitlist audit", service.from("appointment_waitlist_events")
    .select("kind").eq("clinic_id", clinicId));
  assert("候補加入與狀態變更具可追溯紀錄", history.some((row) => row.kind === "joined") && history.some((row) => row.kind === "status_changed"));
  void timeTemplate;
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try { await cleanup(); pass("預約生命週期臨時資料與 Auth 帳號已清理"); }
  catch (error) { fail(`清理失敗: ${error instanceof Error ? error.message : String(error)}`); }
}

if (failed) process.exit(1);
console.log("Staging booking lifecycle audit passed.");
