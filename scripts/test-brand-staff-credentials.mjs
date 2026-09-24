import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

function staffHarness({ members = {}, authPages = [[]] } = {}) {
  const calls = [];
  const membersById = members;
  const query = {
    select() { return this; },
    eq(key, value) { calls.push(["filter", key, value]); return this; },
    async maybeSingle() {
      const userId = [...calls].reverse().find(([kind, key]) => kind === "filter" && key === "user_id")?.[2];
      return { data: membersById[userId] ?? null, error: null };
    },
  };
  const service = {
    from(table) {
      assert.equal(table, "clinic_members");
      return {
        ...query,
        async upsert(row) { calls.push(["upsert", row]); return { error: null }; },
      };
    },
    auth: {
      admin: {
        async listUsers({ page }) { calls.push(["listUsers", page]); return { data: { users: authPages[page - 1] ?? [], nextPage: page < authPages.length ? page + 1 : null }, error: null }; },
        async inviteUserByEmail(email, options) { calls.push(["invite", email, options]); return { data: { user: { id: "invited-id" } }, error: null }; },
        async getUserById(id) { calls.push(["getUser", id]); return { data: { user: { id, email: `${id}@example.invalid` } }, error: null }; },
        async updateUserById() { throw new Error("A brand admin must not set global credentials"); },
        async createUser() { throw new Error("A brand admin must not choose global credentials"); },
      },
      async resetPasswordForEmail(email, options) { calls.push(["resetEmail", email, options]); return { error: null }; },
    },
  };
  const deps = {
    "@/lib/admin-query": { adminQuery: (promise) => promise, adminErrorMessage: (error) => String(error) },
    "next/cache": { revalidatePath: (path) => calls.push(["revalidate", path]) },
    "next/navigation": { redirect: (path) => calls.push(["redirect", path]) },
    "@/lib/admin": { requireBrandAdmin: async () => ({ clinicId: "own-clinic", user: { id: "actor" } }) },
    "@/lib/access-control": {
      normalizeBrandPermissions: (values) => values,
      legacyBrandRoleForPermissions: () => "staff",
    },
    "@/lib/supabase": { createServiceClient: () => service },
    "@/lib/auth-invite": { authInviteRedirectUrl: () => "https://staging.example.invalid/auth/accept-invite" },
  };
  const source = fs.readFileSync("app/admin/users/actions.ts", "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name) => deps[name] ?? {}, FormData, Error,
  });
  return { actions: exports, calls };
}

function staffForm(email) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("access_type", "employee");
  fd.append("permissions", "operations.manage");
  return fd;
}

test("new staff gets a self-service invitation without an admin-supplied password", async () => {
  const { actions, calls } = staffHarness();
  const fd = staffForm("new@example.invalid");
  fd.set("password", "admin-knows-this-password");
  await actions.createStaffAction(fd);
  const invite = calls.find(([kind]) => kind === "invite");
  assert.equal(invite?.[1], "new@example.invalid");
  assert.equal(invite?.[2].redirectTo, "https://staging.example.invalid/auth/accept-invite");
  assert.equal(calls.find(([kind]) => kind === "upsert")?.[1].user_id, "invited-id");
  assert.equal(calls.find(([kind]) => kind === "redirect")?.[1], "/admin/users?notice=invited");
  assert.ok(!calls.some(([kind]) => kind === "resetEmail"));
});

test("existing account after the first Auth page is assigned without an invitation or password change", async () => {
  const { actions, calls } = staffHarness({ authPages: [[{ id: "other", email: "other@example.invalid" }], [{ id: "existing", email: "existing@example.invalid" }]] });
  await actions.createStaffAction(staffForm("existing@example.invalid"));
  assert.deepEqual(calls.filter(([kind]) => kind === "listUsers").map(([, page]) => page), [1, 2]);
  assert.equal(calls.find(([kind]) => kind === "upsert")?.[1].user_id, "existing");
  assert.equal(calls.find(([kind]) => kind === "redirect")?.[1], "/admin/users?notice=existing");
  assert.ok(!calls.some(([kind]) => kind === "invite"));
});

test("foreign brand member cannot trigger a global password email", async () => {
  const { actions, calls } = staffHarness();
  const fd = new FormData(); fd.set("user_id", "foreign");
  await assert.rejects(actions.sendStaffPasswordSetupAction(fd), /找不到目標成員/);
  assert.ok(!calls.some(([kind]) => kind === "getUser" || kind === "resetEmail"));
  assert.ok(calls.some(([kind, key, value]) => kind === "filter" && key === "clinic_id" && value === "own-clinic"));
});

test("own employee receives self-service setup email; brand admin cannot choose a global password", async () => {
  const { actions, calls } = staffHarness({ members: { employee: { access_type: "employee" }, manager: { access_type: "brand_admin" } } });
  const fd = new FormData(); fd.set("user_id", "employee"); fd.set("password", "ignored-secret");
  await actions.sendStaffPasswordSetupAction(fd);
  const resetEmail = calls.find(([kind]) => kind === "resetEmail");
  assert.equal(resetEmail?.[1], "employee@example.invalid");
  assert.equal(resetEmail?.[2].redirectTo, "https://staging.example.invalid/auth/accept-invite");
  assert.equal(calls.find(([kind]) => kind === "redirect")?.[1], "/admin/users?notice=password-email");
  const manager = new FormData(); manager.set("user_id", "manager");
  await assert.rejects(actions.sendStaffPasswordSetupAction(manager), /管理者請從個人帳號頁/);
  assert.equal(calls.filter(([kind]) => kind === "resetEmail").length, 1);
});
