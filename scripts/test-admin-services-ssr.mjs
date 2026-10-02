import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fixture-brand';
const privateError = 'PRIVATE_SERVICES_DB_ERROR';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

function fixture({ failTable = '', deny = false } = {}) {
  const calls = [];
  let serverClientCalls = 0;
  const services = Array.from({ length: 1001 }, (_, index) => ({
    id: `service-${String(index).padStart(4, '0')}`, clinic_id: clinicId,
    name: `服務 ${index}`, category: 'general', description: null, price: 0,
    duration_minutes: 30, buffer_minutes: 0, booking_target: index === 1000 ? 'resource_only' : 'provider_required',
    booking_fields: [], active: true,
  }));
  const addons = Array.from({ length: 1001 }, (_, index) => ({
    id: `addon-${String(index).padStart(4, '0')}`, clinic_id: clinicId,
    service_id: services[index].id, name: `加購 ${index}`, description: null,
    duration_minutes: 0, price: 10, active: true,
  }));
  const rows = { services, service_addons: addons };
  const client = { from(table) {
    const call = { table, projection: '', filters: [], orders: [], range: null };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && call.range?.[0] === 1000) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        let data = rows[table] ?? [];
        for (const [method, column, value] of call.filters) if (method === 'eq') data = data.filter(row => row[column] === value);
        const [from, to] = call.range ?? [0, 999];
        return Promise.resolve({ data: data.slice(from, to + 1), error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (key === 'eq') call.filters.push([key, ...args]);
        if (key === 'order') call.orders.push(args[0]);
        if (key === 'range') call.range = args;
        return query;
      };
    } });
    return query;
  } };
  const pagination = load('lib/supabase-pagination.ts', {
    'server-only': {},
    '@/lib/admin-query': { adminQuery: async promise => await promise, adminErrorMessage: () => '目前無法確認操作結果' },
  });
  const page = load('app/admin/services/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase-pagination': pagination,
    '@/lib/supabase-server': { createSupabaseServer: async () => { serverClientCalls++; return client; } },
    '@/lib/admin': { requireAdmin: async () => { if (deny) throw Error('DENIED'); return { clinicId }; } },
    '../service-actions': { createServiceAction: () => {}, updateServiceAction: () => {}, toggleServiceAction: () => {}, deleteServiceAction: () => {} },
    './ServiceManager': { default: ({ items }) => jsx.jsx('section', { children: `services:${items.length}:${items.at(-1)?.name}` }) },
    './ServiceAddonManager': { ServiceAddonManager: ({ services: itemServices, addons: itemAddons }) => jsx.jsx('section', { children: `addons:${itemServices.length}:${itemAddons.length}:${itemAddons.at(-1)?.name}` }) },
    './addon-actions': { createServiceAddonAction: () => {}, toggleServiceAddonAction: () => {}, updateServiceAddonAction: () => {} },
    '@/components/admin/ManagementTabs': { ServiceSetupTabs: () => null },
  });
  return { page, calls, serverClientCalls: () => serverClientCalls };
}

test('service page includes row 1001 in service and add-on management with exact metrics', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /啟用服務<\/span><strong[^>]*>1001<\/strong>/);
  assert.match(html, /免指定人員<\/span><strong[^>]*>1<\/strong>/);
  assert.match(html, /啟用加購<\/span><strong[^>]*>1001<\/strong>/);
  assert.match(html, /services:1001:服務 1000/);
  assert.match(html, /addons:1001:1001:加購 1000/);
  for (const table of ['services', 'service_addons']) {
    const calls = f.calls.filter(call => call.table === table);
    assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999]]);
    assert.ok(calls.every(call => call.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === clinicId)));
    assert.ok(calls.every(call => call.orders.includes('id')));
    assert.ok(calls.every(call => !call.projection.includes('*')));
  }
});

for (const table of ['services', 'service_addons']) {
  test(`service page fails closed when ${table} page two fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.page.default(), error => {
      assert.match(error.message, /目前無法確認操作結果/);
      assert.ok(!error.message.includes(privateError));
      return true;
    });
  });
}

test('service page denies role before opening server client', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page.default(), /DENIED/);
  assert.equal(f.serverClientCalls(), 0);
  assert.equal(f.calls.length, 0);
});
