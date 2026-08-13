import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const browserSecret = process.env.BROWSER_BOOKING_SECRET;
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "";
const baseUrl = (process.env.STAGING_BASE_URL ?? process.env.PUBLIC_APP_URL ?? "https://reservation-system-staging-staging.up.railway.app").replace(/\/$/, "");

if (!supabaseUrl || !serviceKey || !browserSecret) throw new Error("缺少 Supabase 或 BROWSER_BOOKING_SECRET staging 環境變數");
if (browserSecret.length < 32) throw new Error("BROWSER_BOOKING_SECRET 長度不足");
if (environmentName.toLowerCase() !== "staging") throw new Error(`僅允許 staging；目前環境為 ${environmentName || "unknown"}`);

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const qaNamePrefix = `QA Browser Identity ${suffix}`;
const qaClinicSlug = `qa-browser-${suffix}`;
const sourcePatientIds = [];
const appointmentIds = [];
let isolatedClinicId = null;
let isolatedPatientId = null;
let createdDoctorId = null;
let failed = false;

function pass(message) { console.log(`[PASS] ${message}`); }
function fail(message) { failed = true; console.error(`[FAIL] ${message}`); }
function assert(message, condition) { condition ? pass(message) : fail(message); }

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function createBrowserToken(clinicId, patientId) {
  const payload = Buffer.from(JSON.stringify({
    clinicId,
    patientId,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", browserSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "reservation-staging-browser-identity-audit" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function cleanup() {
  const errors = [];
  async function remove(label, promise) {
    const { error } = await promise;
    if (error) errors.push(`${label}: ${error.message}`);
  }

  if (appointmentIds.length > 0) {
    await remove("appointment notifications", service.from("appointment_notification_logs").delete().in("appointment_id", appointmentIds));
    await remove("appointment status events", service.from("appointment_status_events").delete().in("appointment_id", appointmentIds));
    await remove("appointment reminders", service.from("reminder_logs").delete().in("appointment_id", appointmentIds));
    await remove("appointment CRM interactions", service.from("crm_interactions").delete().in("appointment_id", appointmentIds));
    await remove("source appointments", service.from("appointments").delete().in("id", appointmentIds));
  }
  if (sourcePatientIds.length > 0) await remove("source patients", service.from("patients").delete().in("id", sourcePatientIds));
  if (createdDoctorId) await remove("source doctor", service.from("doctors").delete().eq("id", createdDoctorId));

  if (isolatedClinicId) {
    if (isolatedPatientId) await remove("isolated patient", service.from("patients").delete().eq("id", isolatedPatientId));
    await remove("isolated LINE channel", service.from("clinic_line_channels").delete().eq("clinic_id", isolatedClinicId));
    await remove("isolated entitlements", service.from("brand_entitlements").delete().eq("clinic_id", isolatedClinicId));
    await remove("isolated settings", service.from("clinic_settings").delete().eq("clinic_id", isolatedClinicId));
    await remove("isolated clinic", service.from("clinics").delete().eq("id", isolatedClinicId));
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
}

try {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  const domain = await must("resolve staging hostname", service.from("clinic_domains")
    .select("clinic_id").eq("hostname", hostname).eq("active", true).not("verified_at", "is", null).maybeSingle());
  if (!domain?.clinic_id) throw new Error(`staging hostname 尚未綁定已驗證品牌：${hostname}`);
  const sourceClinic = await must("read staging source brand", service.from("clinics")
    .select("id,slug").eq("id", domain.clinic_id).eq("active", true).single());
  const sourceSettings = await must("read staging booking setting", service.from("clinic_settings")
    .select("public_booking_enabled").eq("clinic_id", sourceClinic.id).single());
  if (!sourceSettings.public_booking_enabled) throw new Error("staging 來源品牌未開放瀏覽器預約");

  const isolatedClinic = await must("create isolated brand", service.from("clinics").insert({
    name: `${qaNamePrefix} Brand B`, slug: qaClinicSlug, active: true,
  }).select("id").single());
  isolatedClinicId = isolatedClinic.id;
  const isolatedPatient = await must("create isolated patient", service.from("patients").insert({
    clinic_id: isolatedClinicId,
    name: `${qaNamePrefix} Patient B`,
    phone: `08${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
    birthday: "1991-02-03",
  }).select("id").single());
  isolatedPatientId = isolatedPatient.id;

  const sourcePhone = `09${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`;
  const start = await post(`/api/booking/browser/start?clinic_slug=${encodeURIComponent(sourceClinic.slug)}`, {
    name: `${qaNamePrefix} Patient A`, phone: sourcePhone, birthday: "1990-01-02",
  });
  const sourceToken = start.json?.data?.browser_token;
  assert("瀏覽器備援可在已驗證品牌建立簽章身分", start.status === 200 && start.json?.ok === true && typeof sourceToken === "string");
  if (typeof sourceToken !== "string") throw new Error(`browser start failed: HTTP ${start.status}`);

  const sourcePatient = await must("read source patient", service.from("patients")
    .select("id").eq("clinic_id", sourceClinic.id).eq("phone", sourcePhone).eq("birthday", "1990-01-02").single());
  sourcePatientIds.push(sourcePatient.id);
  const otherPatient = await must("create other source patient", service.from("patients").insert({
    clinic_id: sourceClinic.id,
    name: `${qaNamePrefix} Other Patient`,
    phone: `07${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
    birthday: "1992-03-04",
  }).select("id").single());
  sourcePatientIds.push(otherPatient.id);

  const providerRows = await must("read source provider", service.from("doctors")
    .select("id").eq("clinic_id", sourceClinic.id).eq("active", true).limit(1));
  let doctorId = providerRows?.[0]?.id ?? null;
  if (!doctorId) {
    const doctor = await must("create source provider", service.from("doctors").insert({
      clinic_id: sourceClinic.id, name: `${qaNamePrefix} Provider`, active: true,
    }).select("id").single());
    doctorId = doctor.id;
    createdDoctorId = doctor.id;
  }

  const firstStart = new Date(Date.now() + 14 * 86_400_000);
  firstStart.setUTCMinutes(0, 0, 0);
  const secondStart = new Date(firstStart.getTime() + 3_600_000);
  const insertedAppointments = await must("create source appointments", service.from("appointments").insert([
    {
      clinic_id: sourceClinic.id, doctor_id: doctorId, patient_id: sourcePatient.id,
      start_at: firstStart.toISOString(), end_at: new Date(firstStart.getTime() + 1_800_000).toISOString(),
      visit_type: "return", source: "online", status: "booked",
    },
    {
      clinic_id: sourceClinic.id, doctor_id: doctorId, patient_id: otherPatient.id,
      start_at: secondStart.toISOString(), end_at: new Date(secondStart.getTime() + 1_800_000).toISOString(),
      visit_type: "return", source: "online", status: "booked",
    },
  ]).select("id,patient_id"));
  appointmentIds.push(...insertedAppointments.map((row) => row.id));
  const ownAppointment = insertedAppointments.find((row) => row.patient_id === sourcePatient.id);
  const otherAppointment = insertedAppointments.find((row) => row.patient_id === otherPatient.id);
  if (!ownAppointment || !otherAppointment) throw new Error("建立身分隔離預約資料失敗");

  const ownList = await post(`/api/booking/browser/my?clinic_slug=${encodeURIComponent(sourceClinic.slug)}`, { browser_token: sourceToken });
  const visibleAppointments = ownList.json?.data?.appointments ?? [];
  assert("有效 token 只列出同品牌且屬於自己的預約", ownList.status === 200 && visibleAppointments.some((row) => row.id === ownAppointment.id) && !visibleAppointments.some((row) => row.id === otherAppointment.id));

  const forbiddenCancel = await post(`/api/booking/cancel?clinic_slug=${encodeURIComponent(sourceClinic.slug)}`, {
    browser_token: sourceToken, appointment_id: otherAppointment.id,
  });
  assert("同品牌 token 不可取消其他顧客預約", forbiddenCancel.status === 403);
  const forbiddenReschedule = await post(`/api/booking/reschedule?clinic_slug=${encodeURIComponent(sourceClinic.slug)}`, {
    browser_token: sourceToken, appointment_id: otherAppointment.id,
  });
  assert("同品牌 token 不可改期其他顧客預約", forbiddenReschedule.status === 403);
  const otherAfter = await must("verify other appointment unchanged", service.from("appointments")
    .select("status").eq("id", otherAppointment.id).single());
  assert("被拒絕的操作沒有改動其他顧客資料", otherAfter.status === "booked");

  const crossBrandToken = createBrowserToken(isolatedClinicId, isolatedPatientId);
  const crossBrandList = await post(`/api/booking/browser/my?clinic_slug=${encodeURIComponent(sourceClinic.slug)}`, { browser_token: crossBrandToken });
  assert("品牌 B token 無法讀取品牌 A 入口", crossBrandList.status === 403 && crossBrandList.json?.ok === false);

  const switchedSlug = await post(`/api/booking/browser/my?clinic_slug=${encodeURIComponent(qaClinicSlug)}`, { browser_token: sourceToken });
  const switchedBody = JSON.stringify(switchedSlug.json ?? {});
  assert("URL clinic_slug 無法把已驗證網域切換到其他品牌", switchedSlug.status >= 400 && !switchedBody.includes(ownAppointment.id));

  const tamperedToken = `${sourceToken.slice(0, -1)}${sourceToken.endsWith("a") ? "b" : "a"}`;
  const tampered = await post(`/api/booking/browser/my?clinic_slug=${encodeURIComponent(sourceClinic.slug)}`, { browser_token: tamperedToken });
  assert("竄改的瀏覽器 token 被拒絕", tampered.status === 401 && tampered.json?.ok === false);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try { await cleanup(); pass("瀏覽器身分 audit 臨時資料已清理"); }
  catch (error) { fail(`清理失敗：${error instanceof Error ? error.message : String(error)}`); }
}

if (failed) process.exit(1);
console.log("Staging browser identity audit passed.");
