import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, dependencies, env) {
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
    process: { env }, URL, Headers, Date, Intl,
  });
  return exports;
}

function pageFor(env) {
  const publicOrigin = load("lib/public-origin.ts", { "server-only": {} }, env);
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
  };
  const db = { from() { return query; } };
  return load("app/admin/documents/page.tsx", {
    "react/jsx-runtime": jsx,
    "@/lib/admin-query": { adminQuery: value => value, adminErrorMessage: () => "讀取失敗" },
    "@/lib/supabase-pagination": { fetchAllSupabasePages: async () => [] },
    "@/components/admin/PatientPicker": { PatientPicker: () => null },
    "next/headers": { headers: async () => new Headers({
      host: "reservation-system-staging-staging.up.railway.app",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "https",
    }) },
    "@/lib/public-origin": publicOrigin,
    "@/lib/admin": { requireNonProvider: async () => ({ role: "brand_admin", clinicId: "fixture" }), canViewSensitiveCustomerData: () => true },
    "@/lib/supabase-server": { createSupabaseServer: async () => db },
    "@/components/SubmitButton": { SubmitButton: ({ children }) => jsx.jsx("button", { children }) },
    "./actions": { cancelDocumentRequestAction() {}, createDocumentTemplateAction() {}, issueDocumentRequestAction() {} },
  }, env).default;
}

function linePageFor(env) {
  const publicOrigin = load("lib/public-origin.ts", { "server-only": {} }, env);
  const rows = {
    clinics: { line_destination: null },
    clinic_settings: { line_channel_enabled: false, brand_logo_url: null },
    clinic_line_channels: { connection_mode: "shared", liff_endpoint_path: "/book", verification_status: "pending" },
    patients: null,
  };
  const db = { from(table) {
    const query = { select() { return this; }, eq() { return this; }, not() { return this; }, limit() { return this; },
      maybeSingle() { return Promise.resolve({ data: rows[table], error: null }); } };
    return query;
  } };
  const noop = () => {};
  return load("app/admin/line/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/headers": { headers: async () => new Headers({ host: "trusted.example", "x-forwarded-host": "attacker.example" }) },
    "next/link": { default: ({ children, href }) => jsx.jsx("a", { href, children }) },
    "@/lib/admin-query": { adminQuery: value => value, adminErrorMessage: () => "讀取失敗" },
    "@/lib/delivery-error": { deliveryError: () => "安全錯誤" },
    "@/lib/supabase-server": { createSupabaseServer: async () => db },
    "@/lib/supabase": { createServiceClient: () => db },
    "@/lib/public-origin": publicOrigin,
    "@/lib/line": { lineAccessTokenForDestination: async () => null, getLineCredentialStatus: async () => ({ configured: false, source: "none" }),
      getBotInfo: noop, getQuota: noop, getQuotaConsumption: noop },
    "@/lib/admin": { requireAdmin: async () => ({ clinicId: "fixture", accessType: "brand_admin" }) },
    "../line-actions": { saveLineCredentialsAction: noop, sendTestPushAction: noop, updateLineChannelSettingsAction: noop, verifyLineChannelSettingsAction: noop },
    "@/components/SubmitButton": { SubmitButton: ({ children }) => jsx.jsx("button", { children }) },
    "@/app/admin/_components/ChannelMessagePreview": { default: () => null },
  }, env).default;
}

test("document signing token uses configured public origin despite spoofed forwarded host", async () => {
  const Page = pageFor({ NODE_ENV: "production", APP_URL: "https://trusted.example" });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ sign_token: "canary-token" }) }));
  assert.match(html, /https:\/\/trusted\.example\/sign\/canary-token/);
  assert.doesNotMatch(html, /attacker\.example/);
});

test("document signing link fails closed without a configured production origin", async () => {
  const Page = pageFor({ NODE_ENV: "production" });
  await assert.rejects(() => Page({ searchParams: Promise.resolve({ sign_token: "canary-token" }) }), /公開 APP_URL/);
});

test("LINE setup copies canonical webhook and LIFF endpoints", async () => {
  const Page = linePageFor({ NODE_ENV: "production", APP_URL: "https://trusted.example" });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.match(html, /https:\/\/trusted\.example\/api\/line\/webhook/);
  assert.match(html, /https:\/\/trusted\.example\/book/);
  assert.doesNotMatch(html, /attacker\.example/);
});
