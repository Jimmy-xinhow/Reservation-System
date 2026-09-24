import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const mode = process.argv[2] ?? "setup";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "";
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase staging environment variables");
if (environmentName.toLowerCase() !== "staging") throw new Error(`Refusing to run outside staging: ${environmentName || "unknown"}`);

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const emailPrefix = "qa-role-";
const clinicPrefix = "qa-role-";

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function removeClinic(clinicId) {
  const failures = [];
  async function remove(table) {
    const { error } = await service.from(table).delete().eq("clinic_id", clinicId);
    if (error) failures.push(`${table}: ${error.message}`);
  }
  for (const table of [
    "line_richmenu_publication_events",
    "line_richmenu_schedules",
    "line_richmenu_aliases",
    "line_richmenu",
    "line_richmenu_versions",
    "funnel_events",
    "appointment_waitlist_notification_logs",
    "appointment_waitlist_events",
    "appointment_waitlist_entries",
    "appointment_notification_logs",
    "appointment_status_events",
    "reminder_logs",
    "crm_delivery_logs",
    "crm_interactions",
    "payment_status_events",
    "payment_webhook_events",
    "payment_transactions",
    "payment_orders",
    "discount_redemptions",
    "appointments",
    "appointment_series",
    "schedule_templates",
    "schedule_exceptions",
    "service_addons",
    "services",
    "doctors",
    "patients",
    "clinic_members",
    "attendance_settings",
    "clinic_line_channels",
    "brand_entitlements",
    "clinic_settings",
    "clinic_activation_metrics",
  ]) await remove(table);
  const { error } = await service.from("clinics").delete().eq("id", clinicId);
  if (error) failures.push(`clinics: ${error.message}`);
  if (failures.length) throw new Error(failures.join("; "));
}

async function cleanup({ suffix, clinicId, userIds }) {
  if (!/^\d{13}-[0-9a-f]{6}$/.test(suffix) ||
      (clinicId !== null && !/^[0-9a-f-]{36}$/.test(clinicId)) ||
      !Array.isArray(userIds) || userIds.some((id) => !/^[0-9a-f-]{36}$/.test(id)) ||
      new Set(userIds).size !== userIds.length) {
    throw new Error("Invalid exact role fixture cleanup scope");
  }
  if (clinicId) {
    const clinic = await must("verify role fixture clinic", service.from("clinics")
      .select("id,slug").eq("id", clinicId).maybeSingle());
    if (clinic && clinic.slug !== `${clinicPrefix}${suffix}`) {
      throw new Error("Role fixture clinic scope mismatch");
    }
  }
  for (const userId of userIds) {
    const result = await service.auth.admin.getUserById(userId);
    if (result.error || !result.data.user?.email?.startsWith(emailPrefix) ||
        !result.data.user.email.endsWith(`-${suffix}@example.invalid`)) {
      throw new Error(`Role fixture user scope mismatch: ${userId}`);
    }
  }
  if (clinicId) await removeClinic(clinicId);
  for (const userId of userIds) {
    await must("remove role fixture platform admin", service.from("platform_admins").delete().eq("user_id", userId));
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw new Error(`delete role fixture auth user ${userId}: ${error.message}`);
  }
  return { clinics: clinicId ? 1 : 0, users: userIds.length };
}

if (mode === "list") {
  const [from, to] = process.argv.slice(3);
  if (![from, to].every((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))) {
    throw new Error("Usage: list <from UTC> <to UTC>");
  }
  const clinics = await must("list role fixtures in UTC window", service.from("clinics")
    .select("id,slug,created_at").like("slug", `${clinicPrefix}%`)
    .gte("created_at", from).lte("created_at", to));
  const scopes = [];
  for (const clinic of clinics ?? []) {
    const suffix = clinic.slug.slice(clinicPrefix.length);
    const userIds = [];
    let page = 1;
    while (true) {
      const result = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (result.error) throw result.error;
      userIds.push(...(result.data.users ?? [])
        .filter((user) => user.email?.startsWith(emailPrefix) &&
          user.email.endsWith(`-${suffix}@example.invalid`))
        .map((user) => user.id));
      if ((result.data.users ?? []).length < 1000) break;
      page += 1;
    }
    scopes.push({ clinicId: clinic.id, slug: clinic.slug, createdAt: clinic.created_at, suffix, userIds });
  }
  console.log(JSON.stringify(scopes));
  process.exit(0);
}
if (mode === "cleanup") {
  const [suffix, clinicIdArg, ...userIds] = process.argv.slice(3);
  const scope = { suffix, clinicId: clinicIdArg === "-" ? null : clinicIdArg, userIds };
  console.log(JSON.stringify({ cleaned: await cleanup(scope) }));
  process.exit(0);
}
if (mode !== "setup") throw new Error("Usage: node scripts/staging-role-fixture.mjs [setup|list|cleanup]");

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const password = `${randomBytes(18).toString("base64url")}!Aa1`;
const identities = ["system-admin", "system-employee", "brand-admin", "brand-employee"];
const users = {};
let clinic = null;
try {
  for (const identity of identities) {
    const email = `${emailPrefix}${identity}-${suffix}@example.invalid`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`create ${identity}: ${created.error?.message ?? "missing user"}`);
    users[identity] = { id: created.data.user.id, email, password };
  }

  clinic = await must("create role fixture clinic", service.from("clinics").insert({
    name: "QA Role Matrix Brand", slug: `${clinicPrefix}${suffix}`, active: true,
  }).select("id,slug").single());
  await must("enable role fixture modules", service.from("clinic_settings").upsert({
    clinic_id: clinic.id,
    events_enabled: true,
    memberships_enabled: true,
    crm_automation_enabled: true,
    line_channel_enabled: true,
  }, { onConflict: "clinic_id" }));
  await must("create brand identities", service.from("clinic_members").insert([
  {
    clinic_id: clinic.id, user_id: users["system-admin"].id, role: "admin",
    access_type: "brand_admin", permissions: ["brand.manage", "operations.manage"],
  },
  {
    clinic_id: clinic.id, user_id: users["brand-admin"].id, role: "admin",
    access_type: "brand_admin", permissions: ["brand.manage", "operations.manage"],
  },
  {
    clinic_id: clinic.id, user_id: users["brand-employee"].id, role: "staff",
    access_type: "employee", permissions: ["operations.manage"],
  },
  ]));
  await must("create system identities", service.from("platform_admins").insert([
  {
    user_id: users["system-admin"].id, role: "admin", access_type: "system_admin", permissions: [], active: true,
  },
  {
    user_id: users["system-employee"].id, role: "admin", access_type: "employee", permissions: ["platform.overview"], active: true,
  },
  ]));
  await must("create role fixture patient", service.from("patients").insert({
    clinic_id: clinic.id, name: "QA Role Customer", phone: `09${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
  }));
} catch (error) {
  await cleanup({ suffix, clinicId: clinic?.id ?? null, userIds: Object.values(users).map((user) => user.id) });
  throw error;
}

console.log(JSON.stringify({
  clinic,
  suffix,
  baseUrl: process.env.PUBLIC_APP_URL ?? "https://reservation-system-staging-staging.up.railway.app",
  users,
}));
