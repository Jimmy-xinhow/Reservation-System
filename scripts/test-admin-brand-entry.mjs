import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ownBrand = "11111111-1111-4111-8111-111111111111";
const otherBrand = "22222222-2222-4222-8222-222222222222";

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, URL, Error, console: { error() {} },
    require(name) {
      if (name in deps) return deps[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}

const response = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };

test("brand login access checks membership in the requested brand", async () => {
  const route = load("app/api/admin/access/route.ts", {
    "@/lib/delivery-error": { deliveryError: () => "safe" },
    "next/server": { NextResponse: response },
    "@/lib/admin": { getOptionalMember: async () => ({ clinics: [{ id: ownBrand }] }) },
    "@/lib/platform": { getOptionalPlatformAdmin: async () => null },
  });
  const request = (brand) => new Request(`https://example.invalid/api/admin/access?entry=brand&brand=${brand}`);
  assert.equal((await route.GET(request(ownBrand))).body.allowed, true);
  assert.equal((await route.GET(request(otherBrand))).body.allowed, false);
  assert.equal((await route.GET(request("invalid"))).status, 400);
  assert.equal((await route.GET(request(""))).status, 400);
});

test("brand entry shows only active brand identity", async () => {
  const filters = [];
  const query = {
    select(columns) { assert.equal(columns, "id, name"); return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    async maybeSingle() { return { data: { id: ownBrand, name: "測試品牌" }, error: null }; },
  };
  const route = load("app/api/admin/brand-entry/route.ts", {
    "next/server": { NextResponse: response },
    "@/lib/supabase": { createServiceClient: () => ({ from: () => query }) },
    "@/lib/delivery-error": { deliveryError: () => "safe" },
  });
  const result = await route.GET(new Request(`https://example.invalid/api/admin/brand-entry?brand=${ownBrand}`));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), { id: ownBrand, name: "測試品牌" });
  assert.deepEqual(filters, [["id", ownBrand], ["active", true]]);
  assert.equal((await route.GET(new Request("https://example.invalid/api/admin/brand-entry?brand=invalid"))).status, 400);
});
