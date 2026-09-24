import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const privateError = 'PRIVATE_PLATFORM_ERROR Authorization=Bearer secret';

function load(file, dependencies) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Date, Intl, Math, Number, String, Map, Set, Promise,
  });
  return exports;
}

const category = load('lib/error-category.ts', {});
const adminQuery = load('lib/admin-query.ts', { 'server-only': {}, '@/lib/error-category': category });
const pagination = load('lib/supabase-pagination.ts', { 'server-only': {}, '@/lib/admin-query': adminQuery });
const Link = ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children);

function queryFixture({ rows = {}, counts = {}, failure = null, denied = false } = {}) {
  const calls = [];
  let clients = 0;
  function builder(table) {
    const call = { table, selected: '', filters: [], orders: [], range: null, head: false };
    calls.push(call);
    const query = {
      select(columns, options) { call.selected = columns; call.head = options?.head === true; return query; },
      eq(column, value) { call.filters.push([column, value]); return query; },
      order(column, options) { call.orders.push([column, options?.ascending !== false]); return query; },
      range(from, to) { call.range = [from, to]; return query; },
      then(resolve, reject) {
        if (failure?.table === table && (failure.from === undefined || failure.from === call.range?.[0])) {
          if (failure.mode === 'throw') return Promise.reject(new Error(privateError)).then(resolve, reject);
          return Promise.resolve({ data: failure.mode === 'null' ? null : [], count: failure.mode === 'null-count' ? null : 0,
            error: failure.mode === 'error' ? { message: privateError } : null }).then(resolve, reject);
        }
        if (call.head) return Promise.resolve({ data: null, error: null, count: counts[table] ?? 0 }).then(resolve, reject);
        let output = rows[table] ?? [];
        for (const [column, value] of call.filters) output = output.filter(item => item[column] === value);
        for (const [column, ascending] of [...call.orders].reverse()) {
          output = [...output].sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (ascending ? 1 : -1));
        }
        return Promise.resolve({ data: call.range ? output.slice(call.range[0], call.range[1] + 1) : output, error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const service = { from: builder, rpc: builder };
  const platform = { accessType: 'system_admin' };
  const platformDeps = {
    PLATFORM_ADD_ONS: [],
    hasSystemPermission: () => true,
    requireSystemPermission: async () => {
      if (denied) throw new Error('DENIED');
      return platform;
    },
  };
  const common = {
    'react/jsx-runtime': jsx,
    '@/lib/admin-query': adminQuery,
    '@/lib/platform': platformDeps,
    '@/lib/supabase': { createServiceClient: () => { clients++; return service; } },
    '@/lib/supabase-pagination': pagination,
  };
  const overview = load('app/admin/platform/page.tsx', {
    ...common,
    'next/link': { default: Link },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => React.createElement('button', null, children) },
    './actions': { createPlatformBrandAction: () => {}, setPlatformBrandActiveAction: () => {}, updatePlatformEntitlementAction: () => {} },
  });
  const report = load('app/admin/platform/reports/page.tsx', {
    ...common,
    './TrialObservationPanel': { TrialObservationPanel: () => null },
  });
  return {
    calls,
    clients: () => clients,
    overview: async (section = 'overview') => renderToStaticMarkup(await overview.default({ searchParams: Promise.resolve({ section }) })),
    report: async () => renderToStaticMarkup(await report.default()),
  };
}

function brand(index) {
  return {
    id: `brand-${String(index).padStart(4, '0')}`,
    name: index === 1000 ? '第1001個品牌' : `品牌 ${index}`,
    slug: `brand-${index}`, line_basic_id: 'line-id', active: true,
    created_at: '2026-09-24T00:00:00Z',
  };
}

test('platform brand list and total include brand 1001', async () => {
  const h = queryFixture({ rows: { clinics: Array.from({ length: 1001 }, (_, i) => brand(i)) } });
  const html = await h.overview('brands');
  assert.match(html, /第1001個品牌/);
  assert.match(html, /品牌與交付狀態/);
  assert(h.calls.some(call => call.table === 'clinics' && call.range?.[0] === 1000));
  const clinicOrders = h.calls.find(call => call.table === 'clinics').orders.map(([column]) => column);
  assert.deepEqual(clinicOrders, ['created_at', 'id']);
});

test('platform aggregates member, service and schedule entries beyond first page', async () => {
  const h = queryFixture({ rows: {
    clinics: [brand(0)],
    clinic_members: Array.from({ length: 1001 }, (_, i) => ({ clinic_id: 'brand-0000', user_id: `user-${i}`, role: 'staff' })),
    services: Array.from({ length: 1001 }, (_, i) => ({ clinic_id: 'brand-0000', id: `service-${i}`, active: true })),
    schedule_templates: Array.from({ length: 1001 }, (_, i) => ({ clinic_id: 'brand-0000', id: `schedule-${i}`, active: true })),
    clinic_settings: [{ clinic_id: 'brand-0000', public_booking_enabled: true, public_registration_enabled: false, booking_mode: 'time' }],
  } });
  const html = await h.overview();
  assert.match(html, /品牌成員<\/small><strong>1001<\/strong>/);
  assert.match(html, /啟用服務<\/small><strong>1001<\/strong>/);
  assert.match(html, /完成基本開通<\/small><strong>1<\/strong>/);
  for (const table of ['clinic_members', 'services', 'schedule_templates']) {
    assert(h.calls.some(call => call.table === table && call.range?.[0] === 1000));
  }
});

for (const table of ['clinics', 'brand_entitlements', 'clinic_members', 'clinic_settings', 'services', 'schedule_templates']) {
  test(`${table} second page returned error blocks platform summary`, async () => {
    const h = queryFixture({ rows: { [table]: Array.from({ length: 1001 }, (_, i) => ({ clinic_id: 'brand-0000', id: `id-${i}`, active: true })) },
      failure: { table, from: 1000, mode: 'error' } });
    await assert.rejects(h.overview(), error => error.message.includes('目前無法確認') && !error.message.includes('secret'));
  });
}

test('null count cannot be shown as zero on platform overview', async () => {
  const h = queryFixture({ failure: { table: 'patients', mode: 'null-count' } });
  await assert.rejects(h.overview(), error => error.message.includes('目前無法確認') && !error.message.includes('secret'));
});

test('platform usage RPC includes brand 1001 and keeps aggregate totals', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({
    ...brand(i), members: '2', services: '3', appointments: '4', registrations: '5', patients: '6',
  }));
  const h = queryFixture({ rows: { get_platform_usage_summary: rows } });
  const html = await h.report();
  assert.match(html, /第1001個品牌/);
  assert.match(html, /品牌<\/p><p class="mt-1 text-2xl font-bold text-slate-950">1001<\/p>/);
  assert.match(html, /跨品牌總數/);
  assert(h.calls.some(call => call.table === 'get_platform_usage_summary' && call.range?.[0] === 1000));
  assert.deepEqual(h.calls.find(call => call.table === 'get_platform_usage_summary').orders.map(([column]) => column), ['created_at', 'id']);
});

for (const mode of ['error', 'throw', 'null']) {
  test(`platform usage RPC second page ${mode} fails closed`, async () => {
    const h = queryFixture({ rows: { get_platform_usage_summary: Array.from({ length: 1001 }, (_, i) => ({ ...brand(i), members: 0, services: 0, appointments: 0, registrations: 0, patients: 0 })) },
      failure: { table: 'get_platform_usage_summary', from: 1000, mode } });
    await assert.rejects(h.report(), error =>
      (error.message.includes('目前無法確認') || error.message.includes('讀取清單不完整')) && !error.message.includes('secret'));
  });
}

test('invalid aggregate count cannot render NaN on platform report', async () => {
  const h = queryFixture({ rows: { get_platform_usage_summary: [{ ...brand(0), members: 'NaN', services: 0, appointments: 0, registrations: 0, patients: 0 }] } });
  await assert.rejects(h.report(), error => error.message.includes('目前無法確認') && !error.message.includes('NaN'));
});

test('platform permission rejection happens before service-role read on both pages', async () => {
  const h = queryFixture({ denied: true });
  await assert.rejects(h.overview(), /DENIED/);
  await assert.rejects(h.report(), /DENIED/);
  assert.equal(h.clients(), 0);
  assert.equal(h.calls.length, 0);
});
