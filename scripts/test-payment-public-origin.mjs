import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync("lib/payment-public-origin.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: () => ({}) });
const { verifiedPaymentCustomerOrigin } = exports;

function db(domain) {
  const filters = {};
  const query = {
    select: () => query,
    eq: (key, value) => { filters[key] = value; return query; },
    not: () => query,
    maybeSingle: async () => ({
      data: filters.hostname === "booking-qa.laihowke.com" &&
        filters.clinic_id === "brand-a" && filters.active === true && domain
        ? { hostname: filters.hostname } : null,
      error: null,
    }),
  };
  return { from: (table) => { assert.equal(table, "clinic_domains"); return query; } };
}
function request(host) {
  return { headers: { get: name => name === "host" ? host : null } };
}

test("payment return accepts only the active verified domain for the same brand", async () => {
  assert.equal(await verifiedPaymentCustomerOrigin(request("booking-qa.laihowke.com"), db(true), "brand-a"),
    "https://booking-qa.laihowke.com");
  assert.equal(await verifiedPaymentCustomerOrigin(request("booking-qa.laihowke.com"), db(true), "brand-b"), null);
  assert.equal(await verifiedPaymentCustomerOrigin(request("booking-qa.laihowke.com"), db(false), "brand-a"), null);
  assert.equal(await verifiedPaymentCustomerOrigin(request("attacker.example"), db(true), "brand-a"), null);
  assert.equal(await verifiedPaymentCustomerOrigin(request("booking-qa.laihowke.com,attacker.example"), db(true), "brand-a"), null);
});
