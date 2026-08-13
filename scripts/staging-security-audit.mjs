import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "";

if (!supabaseUrl || !anonKey || !serviceKey) {
  console.error("[security-audit] 缺少 Supabase staging 環境變數");
  process.exit(1);
}
if (environmentName.toLowerCase() !== "staging") {
  console.error(`[security-audit] 僅允許 staging；目前環境為 ${environmentName || "unknown"}`);
  process.exit(1);
}

const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const qaEmail = `qa-rls-${suffix}@example.invalid`;
const qaPassword = `${randomBytes(18).toString("base64url")}!Aa1`;
const qaSlug = `qa-rls-${suffix}`;
let fixtureClinicId = null;
let fixtureUserId = null;
let fixtureAdminUserId = null;
let sourcePatientId = null;
let fixturePatientId = null;
let failed = false;

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`[FAIL] ${message}`);
}

function assert(message, condition) {
  if (condition) pass(message);
  else fail(message);
}

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function cleanup() {
  const errors = [];
  async function remove(label, promise) {
    const { error } = await promise;
    if (error) errors.push(`${label}: ${error.message}`);
  }

  if (sourcePatientId) await remove("source patient", service.from("patients").delete().eq("id", sourcePatientId));
  if (fixturePatientId) await remove("fixture patient", service.from("patients").delete().eq("id", fixturePatientId));
  if (fixtureClinicId) {
    await remove("fixture schedules", service.from("schedule_templates").delete().eq("clinic_id", fixtureClinicId));
    await remove("fixture services", service.from("services").delete().eq("clinic_id", fixtureClinicId));
    await remove("fixture providers", service.from("doctors").delete().eq("clinic_id", fixtureClinicId));
    await remove("fixture member", service.from("clinic_members").delete().eq("clinic_id", fixtureClinicId));
    await remove("fixture LINE channel", service.from("clinic_line_channels").delete().eq("clinic_id", fixtureClinicId));
    await remove("fixture entitlement", service.from("brand_entitlements").delete().eq("clinic_id", fixtureClinicId));
    await remove("fixture settings", service.from("clinic_settings").delete().eq("clinic_id", fixtureClinicId));
    await remove("fixture clinic", service.from("clinics").delete().eq("id", fixtureClinicId));
  }
  if (fixtureUserId) {
    const { error } = await service.auth.admin.deleteUser(fixtureUserId);
    if (error) errors.push(`fixture auth user: ${error.message}`);
  }
  if (fixtureAdminUserId) {
    const { error } = await service.auth.admin.deleteUser(fixtureAdminUserId);
    if (error) errors.push(`fixture admin auth user: ${error.message}`);
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
}

try {
  const sourceClinics = await must(
    "read source clinic",
    service.from("clinics").select("id").eq("active", true).limit(1),
  );
  const sourceClinicId = sourceClinics?.[0]?.id;
  if (!sourceClinicId) throw new Error("staging 沒有可用的來源品牌");

  const sourcePatient = await must(
    "create source patient",
    service.from("patients").insert({
      clinic_id: sourceClinicId,
      name: "QA Tenant A",
      phone: `09${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
      note: null,
    }).select("id").single(),
  );
  sourcePatientId = sourcePatient.id;

  const createdUser = await service.auth.admin.createUser({
    email: qaEmail,
    password: qaPassword,
    email_confirm: true,
  });
  if (createdUser.error || !createdUser.data.user) throw new Error(`create auth user: ${createdUser.error?.message ?? "missing user"}`);
  fixtureUserId = createdUser.data.user.id;
  const createdAdminUser = await service.auth.admin.createUser({
    email: `qa-rls-admin-${suffix}@example.invalid`,
    password: qaPassword,
    email_confirm: true,
  });
  if (createdAdminUser.error || !createdAdminUser.data.user) throw new Error(`create admin auth user: ${createdAdminUser.error?.message ?? "missing user"}`);
  fixtureAdminUserId = createdAdminUser.data.user.id;

  const fixtureClinic = await must(
    "create isolated clinic",
    service.from("clinics").insert({ name: "QA RLS Isolated Brand", slug: qaSlug, active: true }).select("id").single(),
  );
  fixtureClinicId = fixtureClinic.id;
  await must(
    "create fixture membership",
    service.from("clinic_members").insert([
      {
        clinic_id: fixtureClinicId,
        user_id: fixtureUserId,
        role: "staff",
        access_type: "employee",
        permissions: ["operations.manage"],
      },
      {
        clinic_id: fixtureClinicId,
        user_id: fixtureAdminUserId,
        role: "admin",
        access_type: "brand_admin",
        permissions: ["brand.manage", "operations.manage"],
      },
    ]),
  );
  const fixturePatient = await must(
    "create fixture patient",
    service.from("patients").insert({
      clinic_id: fixtureClinicId,
      name: "QA Tenant B",
      phone: `08${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
    }).select("id").single(),
  );
  fixturePatientId = fixturePatient.id;

  const { data: anonymousRows, error: anonymousError } = await anon
    .from("patients")
    .select("id")
    .in("id", [sourcePatientId, fixturePatientId]);
  assert("anon 無法讀取兩個品牌的顧客 PII", !anonymousError && anonymousRows?.length === 0);

  const authenticated = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await authenticated.auth.signInWithPassword({ email: qaEmail, password: qaPassword });
  if (signIn.error) throw new Error(`fixture sign in: ${signIn.error.message}`);

  const { data: visibleRows, error: visibleError } = await authenticated
    .from("patients")
    .select("id, clinic_id")
    .in("id", [sourcePatientId, fixturePatientId]);
  assert(
    "品牌 B 員工只讀到品牌 B 顧客",
    !visibleError && visibleRows?.length === 1 && visibleRows[0]?.id === fixturePatientId && visibleRows[0]?.clinic_id === fixtureClinicId,
  );

  const { data: crossTenantUpdate, error: updateError } = await authenticated
    .from("patients")
    .update({ note: "cross-tenant-write-must-not-land" })
    .eq("id", sourcePatientId)
    .select("id");
  const sourceAfter = await must(
    "verify source patient unchanged",
    service.from("patients").select("note").eq("id", sourcePatientId).single(),
  );
  assert(
    "品牌 B 跨租戶更新品牌 A 顧客不生效",
    !updateError && crossTenantUpdate?.length === 0 && sourceAfter.note === null,
  );

  const { data: ownUpdate, error: ownUpdateError } = await authenticated
    .from("patients")
    .update({ note: "same-tenant-write" })
    .eq("id", fixturePatientId)
    .select("id");
  assert(
    "品牌 B 員工可在自身租戶執行已授權營運寫入",
    !ownUpdateError && ownUpdate?.length === 1 && ownUpdate[0]?.id === fixturePatientId,
  );

  const deniedProviderWrite = await authenticated.from("doctors").insert({
    clinic_id: fixtureClinicId,
    name: "Operations employee must not create provider",
    active: true,
  }).select("id");
  assert("只有日常營運權限的品牌員工不能直接新增服務提供者", Boolean(deniedProviderWrite.error) || deniedProviderWrite.data?.length === 0);

  const authenticatedAdmin = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminSignIn = await authenticatedAdmin.auth.signInWithPassword({
    email: `qa-rls-admin-${suffix}@example.invalid`,
    password: qaPassword,
  });
  if (adminSignIn.error) throw new Error(`fixture admin sign in: ${adminSignIn.error.message}`);
  const adminProvider = await must("brand admin creates provider", authenticatedAdmin.from("doctors").insert({
    clinic_id: fixtureClinicId,
    name: "QA Configuration Provider",
    active: true,
  }).select("id").single());
  const adminService = await must("brand admin creates service", authenticatedAdmin.from("services").insert({
    clinic_id: fixtureClinicId,
    name: "QA Configuration Service",
    duration_minutes: 30,
    booking_target: "provider_required",
    active: true,
  }).select("id,name").single());
  const deniedServiceUpdate = await authenticated.from("services")
    .update({ name: "Unauthorized service change" })
    .eq("id", adminService.id)
    .select("id");
  const serviceAfterDeniedUpdate = await must("verify service configuration unchanged", service.from("services")
    .select("name").eq("id", adminService.id).single());
  assert("只有日常營運權限的品牌員工不能直接修改服務設定", (Boolean(deniedServiceUpdate.error) || deniedServiceUpdate.data?.length === 0) && serviceAfterDeniedUpdate.name === "QA Configuration Service");
  const deniedScheduleWrite = await authenticated.from("schedule_templates").insert({
    clinic_id: fixtureClinicId,
    doctor_id: adminProvider.id,
    service_id: adminService.id,
    weekday: 1,
    start_time: "09:00",
    end_time: "10:00",
    slot_minutes: 30,
    capacity: 1,
    active: true,
  }).select("id");
  assert("只有日常營運權限的品牌員工不能直接新增服務排程", Boolean(deniedScheduleWrite.error) || deniedScheduleWrite.data?.length === 0);
  const adminSchedule = await must("brand admin creates provider schedule", authenticatedAdmin.from("schedule_templates").insert({
    clinic_id: fixtureClinicId,
    doctor_id: adminProvider.id,
    service_id: adminService.id,
    weekday: 1,
    start_time: "09:00",
    end_time: "10:00",
    slot_minutes: 30,
    capacity: 1,
    active: true,
  }).select("id").single());
  assert("品牌管理者可建立服務、人員與排程設定", Boolean(adminProvider.id) && Boolean(adminService.id) && Boolean(adminSchedule.id));
  await authenticatedAdmin.auth.signOut();

  await authenticated.auth.signOut();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try {
    await cleanup();
    pass("臨時租戶、顧客、成員與 Auth 帳號已清理");
  } catch (error) {
    fail(`清理失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exit(1);
console.log("Staging RLS security audit passed.");
