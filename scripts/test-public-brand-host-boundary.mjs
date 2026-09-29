import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const publicHost = "reservation-system-staging-staging.up.railway.app";
const spoofedHost = "attacker.example";

function load(file, dependencies, environment = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: { APP_URL: `https://${publicHost}`, ...environment } },
  });
  return exports;
}

function forwardedHeaders(host = publicHost) {
  return { get(name) {
    if (name === "host") return host;
    if (name === "x-forwarded-host") return spoofedHost;
    return null;
  } };
}

test("homepage brand lookup uses request Host, not a forwarded host", async () => {
  let scope;
  const page = load("app/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: () => null },
    "@/components/Brand": { Brand: () => null },
    "@/lib/supabase": { createServiceClient: () => ({}) },
    "next/headers": { headers: async () => forwardedHeaders() },
    "@/lib/public-brand": { resolvePublicClinicIdFromScope: async (_db, value) => { scope = value; return null; } },
    "@/components/FunnelTracker": { FunnelTracker: () => null },
    "@/components/MarketingHome": { MarketingHome: () => null },
    "@/components/showcase/IndustryShowcase": { IndustryShowcase: () => null },
    "@/lib/public-brand-page": { loadPublicBrandPage: async () => null },
    "@/lib/line-channel": { getClinicLineChannelContext: async () => null },
    "@/lib/customer-entry": { publicCustomerEntryUrl: () => null },
  });
  await page.default({ searchParams: Promise.resolve({ clinic_slug: "fixture-brand" }) });
  assert.equal(scope.host, publicHost);
});

test("homepage resolves a tenant custom domain even when Railway advertises it as its public domain", async () => {
  const qaHost = "booking-qa.laihowke.com";
  let scope;
  const page = load("app/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: () => null },
    "@/components/Brand": { Brand: () => null },
    "@/lib/supabase": { createServiceClient: () => ({}) },
    "next/headers": { headers: async () => forwardedHeaders(qaHost) },
    "@/lib/public-brand": { resolvePublicClinicIdFromScope: async (_db, value) => { scope = value; return null; } },
    "@/components/FunnelTracker": { FunnelTracker: () => null },
    "@/components/MarketingHome": { MarketingHome: () => null },
    "@/components/showcase/IndustryShowcase": { IndustryShowcase: () => null },
    "@/lib/public-brand-page": { loadPublicBrandPage: async () => null },
    "@/lib/line-channel": { getClinicLineChannelContext: async () => null },
    "@/lib/customer-entry": { publicCustomerEntryUrl: () => null },
  }, { RAILWAY_PUBLIC_DOMAIN: qaHost });
  await page.default({ searchParams: Promise.resolve({}) });
  assert.equal(scope.host, qaHost);
});

test("legacy public board uses request Host, not a forwarded host", async () => {
  let scope;
  const page = load("app/q/page.tsx", {
    "react/jsx-runtime": jsx,
    "@/lib/supabase": { createServiceClient: () => ({}) },
    "@/lib/queue": { taipeiToday: () => "2026-09-27", getQueueForDate: async () => [] },
    "next/headers": { headers: async () => forwardedHeaders() },
    "@/lib/public-brand": { resolvePublicClinicIdFromScope: async (_db, value) => { scope = value; return null; } },
    "@/components/Brand": { Brand: () => null },
    "@/components/AutoRefresh": { AutoRefresh: () => null },
  });
  await page.default({ searchParams: Promise.resolve({ clinic_slug: "fixture-brand" }) });
  assert.equal(scope.host, publicHost);
});

test("public API uses the edge Host when Railway nextUrl is localhost", async () => {
  const brand = load("lib/public-brand.ts", { "server-only": {} });
  const qaHost = "booking-qa.laihowke.com";
  const qaId = "34d483fb-c103-401a-8316-ecb39f9a811e";
  const queried = [];
  const db = { from(table) {
    queried.push(table);
    const filters = {};
    const query = {
      select: () => query,
      eq: (key, value) => { filters[key] = value; return query; },
      not: () => query,
      maybeSingle: async () => ({
        data: table === "clinic_domains"
          ? (filters.hostname === qaHost ? { clinic_id: qaId } : null)
          : (filters.id === qaId ? { id: qaId } : null),
        error: null,
      }),
    };
    return query;
  } };
  const request = (host, slug = null) => ({
    nextUrl: { host: "localhost:8080", searchParams: new URLSearchParams(slug ? { clinic_slug: slug } : {}) },
    headers: { get: name => name === "host" ? host : name === "x-forwarded-host" ? "attacker.example" : null },
  });

  assert.equal(await brand.resolvePublicClinicId(request(qaHost), db), qaId);
  assert.equal(await brand.resolvePublicClinicId(request("unverified.example", "qa-line-openroom-20260929"), db), null);
  assert.equal(await brand.resolvePublicClinicId(request(qaHost, "demo-course"), db), null);
  assert.ok(queried.includes("clinic_domains"));
});
