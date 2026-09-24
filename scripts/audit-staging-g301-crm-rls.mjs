// Staging-only direct Auth/PostgREST audit. No channel, cron, or payment calls.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.equal(process.env.RAILWAY_ENVIRONMENT_NAME, "staging");
assert.equal(new URL(url).hostname, "ongjsegewpnbkqugrpom.supabase.co");
assert.ok(anonKey && serviceKey);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const anon = createClient(url, anonKey, options);
const suffix = randomBytes(5).toString("hex");
const outputPath = process.env.G301_AUDIT_OUTPUT_PATH ?? "tmp/g301-crm-rls-result.json";
const brands = [
  { id: randomUUID(), slug: `qa-g301-crm-a-${suffix}` },
  { id: randomUUID(), slug: `qa-g301-crm-b-${suffix}` },
];
const users = [];
const sessions = [];
const rows = { patients: [], crm_segments: [], crm_interactions: [], handoff_tasks: [] };
const checks = [];
const cleanupErrors = [];
let failure = null;

async function must(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.code ?? "unknown"}`);
  return data;
}
function check(label, condition) {
  checks.push({ label, passed: Boolean(condition) });
  assert.ok(condition, label);
  console.log(`PASS ${label}`);
}
async function insert(table, value) {
  const id = randomUUID();
  rows[table].push(id);
  await must(`insert ${table}`, service.from(table).insert({ id, ...value }));
  return id;
}
async function createUser(role, clinicId, memberRole, accessType, permissions) {
  const email = `qa-g301-crm-${role}-${suffix}@example.invalid`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const result = await service.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (result.error || !result.data.user) throw new Error(`create ${role} Auth user failed`);
  const id = result.data.user.id;
  users.push({ id, role });
  await must(`insert ${role} member`, service.from("clinic_members").insert({
    clinic_id: clinicId, user_id: id, role: memberRole, access_type: accessType, permissions,
  }));
  const client = createClient(url, anonKey, options);
  sessions.push(client);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`sign in ${role} failed`);
  return client;
}
async function ids(client, table, values) {
  return client.from(table).select("id").in("id", values);
}
function emptyOrDenied(result) {
  return Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
}

try {
  for (const brand of brands) {
    await must("insert brand", service.from("clinics").insert({
      id: brand.id, slug: brand.slug, name: "QA G3-01 CRM RLS",
      active: true,
    }));
    await must("disable channels", service.from("clinic_settings").update({
      line_channel_enabled: false, email_enabled: false, crm_automation_enabled: false,
    }).eq("clinic_id", brand.id));
    brand.patientId = await insert("patients", {
      clinic_id: brand.id, name: `QA G301 Customer ${brand.slug}`,
      phone: `09${randomBytes(4).toString("hex").replace(/[a-f]/g, "0")}`,
      marketing_opt_in: false,
    });
    brand.segmentId = await insert("crm_segments", {
      clinic_id: brand.id, name: `QA G301 Segment ${brand.slug}`,
      rule_type: "tag_contains", rule_value: "qa", active: false,
    });
    brand.interactionId = await insert("crm_interactions", {
      clinic_id: brand.id, patient_id: brand.patientId,
      kind: "note", channel: "staff", body: `QA G301 Note ${brand.slug}`,
    });
    brand.taskId = await insert("handoff_tasks", {
      clinic_id: brand.id, title: `QA G301 Task ${brand.slug}`,
      category: "customer", status: "open", priority: "normal",
    });
  }
  const [a, b] = brands;
  const adminA = await createUser("admin-a", a.id, "admin", "brand_admin", ["brand.manage", "operations.manage"]);
  const providerA = await createUser("provider-a", a.id, "provider", "employee", ["provider.assigned"]);
  const adminB = await createUser("admin-b", b.id, "admin", "brand_admin", ["brand.manage", "operations.manage"]);

  for (const table of ["patients", "crm_segments", "crm_interactions", "handoff_tasks"]) {
    const ownId = a[table === "patients" ? "patientId" : table === "crm_segments" ? "segmentId" : table === "crm_interactions" ? "interactionId" : "taskId"];
    const foreignId = b[table === "patients" ? "patientId" : table === "crm_segments" ? "segmentId" : table === "crm_interactions" ? "interactionId" : "taskId"];
    check(`anon ${table} cannot read either brand`, emptyOrDenied(await ids(anon, table, [ownId, foreignId])));
    const aRead = await ids(adminA, table, [ownId, foreignId]);
    check(`admin A ${table} sees own only`, !aRead.error && aRead.data?.length === 1 && aRead.data[0].id === ownId);
    const bRead = await ids(adminB, table, [ownId, foreignId]);
    check(`admin B ${table} sees own only`, !bRead.error && bRead.data?.length === 1 && bRead.data[0].id === foreignId);
    if (table !== "patients") {
      check(`provider cannot read ${table}`, emptyOrDenied(await ids(providerA, table, [ownId, foreignId])));
    }
  }

  const foreignTaskUpdate = await adminA.from("handoff_tasks")
    .update({ title: "UNAUTHORIZED" }).eq("id", b.taskId).select("id");
  const taskAfter = await must("read foreign task after update",
    service.from("handoff_tasks").select("title").eq("id", b.taskId).single());
  check("cross-brand handoff update is denied and unchanged",
    emptyOrDenied(foreignTaskUpdate) && taskAfter.title === `QA G301 Task ${b.slug}`);

  const foreignSegmentUpdate = await adminA.from("crm_segments")
    .update({ name: "UNAUTHORIZED" }).eq("id", b.segmentId).select("id");
  const segmentAfter = await must("read foreign segment after update",
    service.from("crm_segments").select("name").eq("id", b.segmentId).single());
  check("cross-brand CRM definition update is denied and unchanged",
    emptyOrDenied(foreignSegmentUpdate) && segmentAfter.name === `QA G301 Segment ${b.slug}`);

  const attemptedForeignTaskId = randomUUID();
  rows.handoff_tasks.push(attemptedForeignTaskId);
  const foreignInsert = await adminA.from("handoff_tasks").insert({
    id: attemptedForeignTaskId, clinic_id: b.id, title: "UNAUTHORIZED", category: "other",
  }).select("id");
  check("cross-brand handoff insert is denied", emptyOrDenied(foreignInsert));
  check("cross-brand handoff insert did not persist",
    (await must("read attempted foreign task", service.from("handoff_tasks").select("id").eq("id", attemptedForeignTaskId))).length === 0);

  const attemptedProviderInteractionId = randomUUID();
  rows.crm_interactions.push(attemptedProviderInteractionId);
  const providerInsert = await providerA.from("crm_interactions").insert({
    id: attemptedProviderInteractionId, clinic_id: a.id, patient_id: a.patientId,
    kind: "note", channel: "staff", body: "UNAUTHORIZED",
  }).select("id");
  check("provider cannot create CRM timeline note", emptyOrDenied(providerInsert));
  check("provider CRM attempt did not persist",
    (await must("read attempted provider note", service.from("crm_interactions").select("id").eq("id", attemptedProviderInteractionId))).length === 0);

  const ownTaskUpdate = await adminA.from("handoff_tasks")
    .update({ status: "done" }).eq("id", a.taskId).select("id");
  const ownTaskAfter = await must("read own task", service.from("handoff_tasks").select("status").eq("id", a.taskId).single());
  check("admin A can update own handoff task", !ownTaskUpdate.error && ownTaskUpdate.data?.length === 1 && ownTaskAfter.status === "done");

  const timelineRewrite = await adminA.from("crm_interactions")
    .update({ body: "UNAUTHORIZED" }).eq("id", a.interactionId).select("id");
  const timelineAfter = await must("read timeline after rewrite attempt",
    service.from("crm_interactions").select("body").eq("id", a.interactionId).single());
  check("even admin cannot rewrite CRM timeline", emptyOrDenied(timelineRewrite) && timelineAfter.body === `QA G301 Note ${a.slug}`);
} catch (error) {
  failure = error instanceof Error ? error.message : "unknown audit failure";
} finally {
  for (const client of sessions) {
    try { await client.auth.signOut(); } catch { /* cleanup continues */ }
  }
  for (const table of ["crm_interactions", "crm_segments", "handoff_tasks", "patients"]) {
    for (const id of rows[table]) {
      const { error } = await service.from(table).delete().eq("id", id);
      if (error) cleanupErrors.push(`${table}:${error.code ?? "unknown"}`);
    }
  }
  for (const brand of brands) {
    for (const table of [
      "clinic_members", "attendance_settings", "clinic_line_channels",
      "brand_entitlements", "clinic_activation_metrics", "clinic_settings",
    ]) {
      const { error } = await service.from(table).delete().eq("clinic_id", brand.id);
      if (error) cleanupErrors.push(`${table}:${error.code ?? "unknown"}`);
    }
    const { error } = await service.from("clinics").delete().eq("id", brand.id).eq("slug", brand.slug);
    if (error) cleanupErrors.push(`clinics:${error.code ?? "unknown"}`);
  }
  for (const user of users) {
    const result = await service.auth.admin.deleteUser(user.id);
    if (result.error) cleanupErrors.push(`auth:${result.error.status ?? "unknown"}`);
  }
  for (const [table, idsToCheck] of Object.entries({
    ...rows, clinics: brands.map((brand) => brand.id),
  })) {
    const result = await service.from(table).select("id", { count: "exact", head: true }).in("id", idsToCheck);
    if (result.error || result.count !== 0) cleanupErrors.push(`residual:${table}`);
  }
  for (const user of users) {
    const result = await service.auth.admin.getUserById(user.id);
    if (!result.error || result.data?.user) cleanupErrors.push("residual:auth");
  }
}

const report = {
  at: new Date().toISOString(),
  target: "staging:ongjsegewpnbkqugrpom",
  checks, failure, cleanupErrors,
  fixtureIds: { clinics: brands.map((brand) => brand.id), users: users.map((user) => user.id), ...rows },
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ checks: checks.length, passed: checks.filter((item) => item.passed).length,
  failure, cleanupErrors, outputPath }));
if (failure || cleanupErrors.length) process.exitCode = 1;
