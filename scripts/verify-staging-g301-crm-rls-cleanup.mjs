// Independent read-only verification of exact IDs from the G3-01 staging audit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const path = process.argv[2] ?? "tmp/g301-crm-rls-result.json";
const report = JSON.parse(readFileSync(path, "utf8"));
assert.equal(report.target, "staging:ongjsegewpnbkqugrpom");
assert.equal(process.env.RAILWAY_ENVIRONMENT_NAME, "staging");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, "ongjsegewpnbkqugrpom.supabase.co");
assert.ok(report.fixtureIds && typeof report.fixtureIds === "object");
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tableCounts = {};
for (const [table, ids] of Object.entries(report.fixtureIds)) {
  if (table === "users") continue;
  assert.ok(Array.isArray(ids) && ids.length > 0);
  const { count, error } = await service.from(table).select("id", { count: "exact", head: true }).in("id", ids);
  assert.ifError(error);
  tableCounts[table] = count;
  assert.equal(count, 0, `${table} fixture residual`);
}
let authResidual = 0;
for (const id of report.fixtureIds.users) {
  const { data, error } = await service.auth.admin.getUserById(id);
  if (!error || data?.user) authResidual += 1;
}
assert.equal(authResidual, 0, "Auth fixture residual");
console.log(JSON.stringify({
  target: report.target, auditedAt: report.at,
  fixtureCounts: Object.fromEntries(Object.entries(report.fixtureIds).map(([key, ids]) => [key, ids.length])),
  tableResiduals: tableCounts, authResidual,
}));
