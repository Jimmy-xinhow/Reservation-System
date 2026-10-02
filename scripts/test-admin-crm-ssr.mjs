import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const privateError = 'PRIVATE_CRM_DATABASE_DETAIL Authorization=Bearer secret-token';
const brand = 'fixture-brand';

function load(file, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    URLSearchParams, Date, Intl,
  });
  return exports;
}

const link = ({ href, children }) => React.createElement('a', { href }, children);
const errorCategory = load('lib/error-category.ts', {});
const adminQuery = load('lib/admin-query.ts', {
  'server-only': {},
  '@/lib/error-category': errorCategory,
});
const pagination = load('lib/supabase-pagination.ts', {
  'server-only': {},
  '@/lib/admin-query': adminQuery,
});

function makeClient(tables, failure = {}) {
  const calls = [];
  const client = { calls, from(table) {
    const call = { table, filters: [], orders: [], range: null, head: false };
    calls.push(call);
    const query = {
      select(_projection, options) { call.head = options?.head === true; return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      is(key, value) { call.filters.push([key, value]); return query; },
      order(key, options) { call.orders.push([key, options?.ascending !== false]); return query; },
      range(from, to) { call.range = [from, to]; return query; },
      then(resolve, reject) {
        if (table === failure.table && call.range?.[0] === failure.from) {
          if (failure.mode === 'throw') return Promise.reject(new Error(privateError)).then(resolve, reject);
          return Promise.resolve({ data: failure.mode === 'null' ? null : [], error: failure.mode === 'error' ? { message: privateError } : null }).then(resolve, reject);
        }
        let rows = tables[table] ?? [];
        for (const [key, value] of call.filters) rows = rows.filter(row => row[key] === value);
        for (const [key, ascending] of [...call.orders].reverse()) {
          rows = [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (ascending ? 1 : -1));
        }
        return Promise.resolve({
          data: call.head ? null : call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows,
          count: call.head ? rows.length : null,
          error: null,
        }).then(resolve, reject);
      },
    };
    return query;
  } };
  return client;
}

function crmTables() {
  const segments = Array.from({ length: 1001 }, (_, i) => ({
    id: `segment-${String(i).padStart(4, '0')}`, clinic_id: brand,
    name: i === 1000 ? '最後一個分眾' : `分眾 ${i}`, description: null,
    rule_type: 'tag_contains', rule_value: 'test', active: true,
    updated_at: '2026-09-23T00:00:00Z', created_at: '2026-09-23T00:00:00Z',
  }));
  const automations = Array.from({ length: 1001 }, (_, i) => ({
    id: `automation-${String(i).padStart(4, '0')}`, clinic_id: brand,
    name: i === 1000 ? '最後一個規則' : `規則 ${i}`, trigger_type: 'birthday',
    segment_id: null, channel: 'line', delay_minutes: 0, trigger_days: 30,
    cooldown_days: 30, subject: null, body: '合成訊息', active: true,
    archived_at: null, created_at: '2026-09-23T00:00:00Z',
  }));
  segments.push({ ...segments[0], id: 'foreign-segment', clinic_id: 'other-brand', name: '外品牌分眾' });
  automations.push({ ...automations[0], id: 'archived', name: '已封存規則', archived_at: '2026-09-23T00:00:00Z' });
  return {
    crm_segments: segments, crm_automations: automations,
    patients: [{ id: 'patient', clinic_id: brand, active: true }],
    crm_delivery_logs: [], crm_segment_members: [],
  };
}

const crmPage = load('app/admin/crm/page.tsx', {
  'react/jsx-runtime': jsx,
  'next/link': { default: link },
  '@/lib/admin': {
    requireMember: async () => crmPage.context,
    canViewSensitiveCustomerData: role => role !== 'staff',
  },
  '@/components/SubmitButton': { SubmitButton: () => null },
  '@/lib/crm': {
    AUTOMATION_TRIGGER_TYPES: ['birthday'], AUTOMATION_TRIGGER_LABELS: { birthday: '生日' },
    SEGMENT_RULE_TYPES: ['tag_contains'], SEGMENT_RULE_LABELS: { tag_contains: '標籤' },
    describeSegmentRule: () => '合成規則',
  },
  './actions': Object.fromEntries([
    'createAutomationAction', 'createSegmentAction', 'deleteAutomationAction',
    'deleteSegmentAction', 'refreshSegmentAction', 'toggleAutomationAction',
    'toggleSegmentAction', 'updateAutomationAction',
  ].map(name => [name, () => {}])),
  '@/lib/admin-modules': { isAdminModuleEnabled: async () => true },
  '@/components/ModuleDisabled': { ModuleDisabled: () => null },
  './AutomationMessageFields': { default: () => null },
  '@/lib/supabase-pagination': pagination,
});

async function renderCrm(client, role = 'admin') {
  crmPage.context = { supabase: client, clinicId: brand, role };
  return renderToStaticMarkup(await crmPage.default({ searchParams: Promise.resolve({}) }));
}

test('CRM lists render row 1001 in both sources while excluding archived and foreign rows', async () => {
  const client = makeClient(crmTables());
  const html = await renderCrm(client);
  assert.match(html, /最後一個分眾/);
  assert.match(html, /最後一個規則/);
  assert(!html.includes('已封存規則'));
  assert(!html.includes('外品牌分眾'));
  for (const table of ['crm_segments', 'crm_automations']) {
    assert(client.calls.some(call => call.table === table && call.range?.[0] === 1000));
  }
  assert(client.calls.every(call => call.filters.some(([key, value]) => key === 'clinic_id' && value === brand)));
});

for (const mode of ['error', 'throw', 'null']) {
  test(`CRM second automation page ${mode} fails closed`, async () => {
    const client = makeClient(crmTables(), { table: 'crm_automations', from: 1000, mode });
    await assert.rejects(renderCrm(client), error =>
      error.message === 'CRM 統計資料讀取不完整，請重新載入後再試' && !error.message.includes('secret-token'));
  });
}

test('CRM role without customer-data permission cannot query rows', async () => {
  const client = makeClient(crmTables());
  const html = await renderCrm(client, 'staff');
  assert.match(html, /無法查看 CRM 顧客資料/);
  assert.equal(client.calls.length, 0);
});

function deliveryTables() {
  const rows = Array.from({ length: 301 }, (_, i) => ({
    id: `delivery-${String(i).padStart(4, '0')}`, clinic_id: brand,
    status: 'failed', channel: 'line', trigger_key: `trigger-${i}`,
    error: null, attempt_count: 1, attempted_at: null, sent_at: null,
    created_at: '2026-09-23T00:00:00Z',
    patients: { name: i === 0 ? '最舊顧客' : `顧客 ${i}`, phone: '0900000000', email: null },
    crm_automations: { name: '已封存規則', trigger_type: 'birthday' },
  }));
  rows.push({ ...rows[0], id: 'delivery-9999', clinic_id: 'other-brand', patients: { name: '外品牌顧客', phone: '0911111111', email: null } });
  return { crm_delivery_logs: rows };
}

const deliveryPage = load('app/admin/crm/deliveries/page.tsx', {
  'react/jsx-runtime': jsx,
  '@/lib/admin-query': adminQuery,
  'next/link': { default: link },
  '@/lib/admin': {
    requireMember: async () => deliveryPage.context,
    canViewSensitiveCustomerData: role => role !== 'staff',
  },
  '@/lib/admin-modules': { isAdminModuleEnabled: async () => true },
  '@/components/ModuleDisabled': { ModuleDisabled: () => null },
  '@/lib/delivery-error': { deliveryError: () => 'delivery_error:connection' },
});

async function renderDeliveries(client, page, role = 'admin') {
  deliveryPage.context = { supabase: client, clinicId: brand, role };
  return renderToStaticMarkup(await deliveryPage.default({
    searchParams: Promise.resolve({ page: String(page), status: 'failed', channel: 'line' }),
  }));
}

test('delivery history reaches row 301, keeps filters, and displays archived automation name', async () => {
  const client = makeClient(deliveryTables());
  const first = await renderDeliveries(client, 1);
  assert.match(first, /page=2/);
  assert(!first.includes('最舊顧客'));
  const fourth = await renderDeliveries(client, 4);
  assert.match(fourth, /最舊顧客/);
  assert.match(fourth, /已封存規則/);
  assert.match(fourth, /status=failed&amp;channel=line&amp;page=3/);
  assert(!fourth.includes('page=5'));
  assert(!fourth.includes('外品牌顧客'));
  assert.deepEqual(client.calls.at(-1).range, [300, 400]);
  assert(client.calls.every(call => call.filters.some(([key, value]) => key === 'clinic_id' && value === brand)));
});

for (const mode of ['error', 'throw', 'null']) {
  test(`delivery history ${mode} fails closed without raw DB text`, async () => {
    const client = makeClient(deliveryTables(), { table: 'crm_delivery_logs', from: 300, mode });
    await assert.rejects(renderDeliveries(client, 4), error =>
      !error.message.includes('secret-token') && /讀取|確認/.test(error.message));
  });
}

test('delivery history role without customer-data permission cannot query rows', async () => {
  const client = makeClient(deliveryTables());
  const html = await renderDeliveries(client, 1, 'staff');
  assert.match(html, /無法查看顧客投遞資料/);
  assert.equal(client.calls.length, 0);
});

test('shared pagination rejects a null page instead of presenting a false empty list', async () => {
  await assert.rejects(pagination.fetchAllSupabasePages(() => Promise.resolve({ data: null, error: null })),
    /讀取清單不完整/);
});
