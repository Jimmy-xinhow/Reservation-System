import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    Error, Date, URL, Response, Intl, Promise, console,
  });
  return exports;
}

function harness({ total, failAfter = null }) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `qa-${i}`, event_id: "event", session_id: "session",
    registration_no: `QA-${i}`, status: "confirmed", name: `Guest ${i}`,
  }));
  const calls = [];
  const supabase = {
    from(table) {
      assert.equal(table, "registrations");
      const call = { filters: [], range: null, select: "" };
      calls.push(call);
      const query = new Proxy({}, {
        get(_, key) {
          if (key === "then") return (resolve, reject) => Promise.resolve().then(() => {
            if (failAfter !== null && call.range[0] >= failAfter) return { data: null, error: { message: "PRIVATE_DATABASE_DETAIL" } };
            return { data: rows.slice(call.range[0], call.range[1] + 1), error: null };
          }).then(resolve, reject);
          return (...args) => {
            if (key === "select") call.select = args[0];
            else if (key === "range") call.range = args;
            else call.filters.push([key, ...args]);
            return query;
          };
        },
      });
      return query;
    },
  };
  const pagination = load("lib/supabase-pagination.ts", {
    "server-only": {},
    "@/lib/admin-query": {
      adminQuery: (query) => query,
      adminErrorMessage: () => "讀取名單失敗",
    },
  });
  const route = load("app/api/registration/checkin-live/route.ts", {
    "@/lib/admin": { requireOperator: async () => ({ clinicId: "qa-brand", supabase }) },
    "@/lib/http": {
      ok: (data) => Response.json({ ok: true, data }),
      fail: (_, status = 400) => Response.json({ ok: false, error: "無法載入報到名單" }, { status }),
    },
    "@/lib/admin-modules": { isAdminModuleEnabled: async () => true },
    "@/lib/supabase-pagination": pagination,
  });
  return {
    calls,
    run: () => route.GET({ nextUrl: new URL("https://example.invalid/api/registration/checkin-live?date=2026-09-29") }),
  };
}

test("live check-in includes the 1,001st registration with stable tenant-scoped paging", async () => {
  const testCase = harness({ total: 1001 });
  const response = await testCase.run();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.length, 1001);
  assert.equal(body.data.at(-1).registration_no, "QA-1000");
  assert.deepEqual(testCase.calls.map((call) => call.range), [[0, 999], [1000, 1999]]);
  for (const call of testCase.calls) {
    assert.ok(call.filters.some(([key, field, value]) => key === "eq" && field === "clinic_id" && value === "qa-brand"));
    assert.ok(call.filters.some(([key, field, options]) => key === "order" && field === "id" && options.ascending === true));
    assert.ok(!call.select.includes("phone") && !call.select.includes("email"));
  }
});

test("failed later page returns an error rather than a partial 1,000-person count", async () => {
  const testCase = harness({ total: 1001, failAfter: 1000 });
  const response = await testCase.run();
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.data, undefined);
  assert.ok(!JSON.stringify(body).includes("PRIVATE_DATABASE_DETAIL"));
  assert.deepEqual(testCase.calls.map((call) => call.range), [[0, 999], [1000, 1999]]);
});
