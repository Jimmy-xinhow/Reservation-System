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
    "clinic_line_channels",
    "brand_entitlements",
    "clinic_settings",
  ]) await remove(table);
  const { error } = await service.from("clinics").delete().eq("id", clinicId);
  if (error) failures.push(`clinics: ${error.message}`);
  if (failures.length) throw new Error(failures.join("; "));
}

async function cleanup() {
  const clinics = await must("list role fixtures", service.from("clinics").select("id").like("slug", `${clinicPrefix}%`));
  for (const clinic of clinics ?? []) await removeClinic(clinic.id);

  let page = 1;
  const userIds = [];
  while (true) {
    const result = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error(`list auth users: ${result.error.message}`);
    const users = result.data.users ?? [];
    userIds.push(...users.filter((user) => user.email?.startsWith(emailPrefix)).map((user) => user.id));
    if (users.length < 1000) break;
    page += 1;
  }
  for (const userId of userIds) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw new Error(`delete auth user ${userId}: ${error.message}`);
  }
  return { clinics: clinics?.length ?? 0, users: userIds.length };
}

if (mode === "cleanup") {
  console.log(JSON.stringify({ cleaned: await cleanup() }));
  process.exit(0);
}
if (mode !== "setup") throw new Error("Usage: node scripts/staging-role-fixture.mjs [setup|cleanup]");

await cleanup();
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const password = `${randomBytes(18).toString("base64url")}!Aa1`;
const identities = ["system-admin", "system-employee", "brand-admin", "brand-employee"];
const users = {};
for (const identity of identities) {
  const email = `${emailPrefix}${identity}-${suffix}@example.invalid`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${identity}: ${created.error?.message ?? "missing user"}`);
  users[identity] = { id: created.data.user.id, email, password };
}

const clinic = await must("create role fixture clinic", service.from("clinics").insert({
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

console.log(JSON.stringify({
  clinic,
  baseUrl: process.env.PUBLIC_APP_URL ?? "https://reservation-system-staging-staging.up.railway.app",
  users,
}));
