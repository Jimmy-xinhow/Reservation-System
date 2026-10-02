import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fixture-brand';
const privateError = 'PRIVATE_LEVELS_DB_ERROR';

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

function fixture({ failTable = '', deny = false, enabled = true } = {}) {
  const calls = [];
  let factoryCalls = 0;
  const levels = Array.from({ length: 1001 }, (_, index) => ({ id: `level-${String(index).padStart(4, '0')}`, clinic_id: clinicId, code: `l${index}`, name: `會員等級 ${index}`, sort_order: index, discount_percent: 5, active: true }));
  const plans = Array.from({ length: 1001 }, (_, index) => ({ id: `plan-${String(index).padStart(4, '0')}`, clinic_id: clinicId, name: `會員套票 ${index}`, price: 100 + index, active: true }));
  const prices = Array.from({ length: 1001 }, (_, index) => ({ id: `price-${String(index).padStart(4, '0')}`, clinic_id: clinicId, plan_id: plans[index].id, level_id: levels[index].id, price: index }));
  const rows = { membership_levels: levels, membership_plans: plans, membership_plan_level_prices: prices };
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
  const page = load('app/admin/membership-levels/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase-pagination': pagination,
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/components/ModuleDisabled': { ModuleDisabled: () => jsx.jsx('p', { children: '模組未啟用' }) },
    '@/lib/admin': { requireAdmin: async () => { if (deny) throw Error('DENIED'); return { clinicId, supabase: client }; } },
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => enabled },
    '@/lib/supabase': { createServiceClient: () => { factoryCalls++; return client; } },
    '../memberships/actions': { createMembershipLevelAction: () => {}, saveMembershipPlanLevelPriceAction: () => {}, toggleMembershipLevelAction: () => {} },
    '@/components/admin/ManagementTabs': { MembershipManagementTabs: () => null },
  });
  return { page, calls, factoryCalls: () => factoryCalls };
}

test('membership level page renders row 1001 from levels, plans and price rules', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /啟用等級/);
  assert.match(html, /會員等級 1000/);
  assert.match(html, /會員套票 1000/);
  assert.match(html, /NT\$1,100/);
  assert.match(html, /會員套票 1000<\/td><td data-label="會員等級">會員等級 1000<\/td><td data-label="專屬價格"[^>]*>NT\$1,000/);
  assert.ok(!html.includes(privateError));
  for (const table of ['membership_levels', 'membership_plans', 'membership_plan_level_prices']) {
    const calls = f.calls.filter(call => call.table === table);
    assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999]]);
    assert.ok(calls.every(call => call.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === clinicId)));
    assert.ok(calls.every(call => call.orders.includes('id')));
    assert.ok(calls.every(call => !call.projection.includes('*')));
  }
});

for (const table of ['membership_levels', 'membership_plans', 'membership_plan_level_prices']) {
  test(`membership level page fails closed when ${table} page two fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.page.default(), error => {
      assert.match(error.message, /目前無法確認操作結果/);
      assert.ok(!error.message.includes(privateError));
      return true;
    });
  });
}

test('membership level page disables module before service client creation', async () => {
  const f = fixture({ enabled: false });
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /模組未啟用/);
  assert.equal(f.factoryCalls(), 0);
  assert.equal(f.calls.length, 0);
});

test('membership level page denies role before service client creation', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page.default(), /DENIED/);
  assert.equal(f.factoryCalls(), 0);
  assert.equal(f.calls.length, 0);
});
