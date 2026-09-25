import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fixture-brand';
const privateError = 'PRIVATE_MEMBERSHIP_DB_ERROR';

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
  const plans = Array.from({ length: 1001 }, (_, index) => ({
    id: `plan-${String(index).padStart(4, '0')}`, clinic_id: clinicId, name: `套票 ${index}`,
    description: null, price: 100 + index, credits_total: 3, valid_days: 30,
    usage_scope: 'both', service_id: null, card_image_url: null,
    card_theme: 'forest', card_accent: '#123456', redeem_channels: ['appointment', 'registration'],
    redemption_note: null, active: true,
  }));
  const services = Array.from({ length: 1001 }, (_, index) => ({ id: `service-${index}`, clinic_id: clinicId, name: `服務 ${index}`, active: true }));
  const codes = Array.from({ length: 1001 }, (_, index) => ({
    id: `code-${index}`, clinic_id: clinicId, code: `CODE${index}`, benefit_type: 'coupon', kind: 'fixed',
    value: 10, min_amount: 0, used_count: 0, max_uses: null, recipient_name: null, recipient_phone: null,
    starts_at: null, ends_at: null, active: true,
  }));
  const memberships = Array.from({ length: 1001 }, (_, index) => ({
    id: `membership-${index}`, clinic_id: clinicId, membership_code: `PASS${index}`,
    status: 'active', credits_total: 3, credits_remaining: 2, expires_at: null,
    redemption_snapshot: index === 1000 ? { usage_scope: 'both', service_id: null, redeem_channels: ['appointment', 'registration', 'offline'] } : null,
    patients: { name: `顧客 ${index}`, phone: `0900${String(index).padStart(6, '0')}` },
    membership_plans: { name: `套票 ${index}`, redeem_channels: ['appointment', 'registration'] },
  }));
  const rows = { membership_plans: plans, services, discount_codes: codes, patient_memberships: memberships };
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
  const snapshot = load('lib/membership-redemption.ts', {});
  const page = load('app/admin/memberships/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase-pagination': pagination,
    '@/lib/membership-redemption': snapshot,
    '@/components/SubmitButton': { SubmitButton: ({ children, disabled }) => jsx.jsx('button', { disabled, children }) },
    '@/components/ModuleDisabled': { ModuleDisabled: () => jsx.jsx('p', { children: '模組未啟用' }) },
    '@/lib/admin': { requireMember: async () => { if (deny) throw Error('DENIED'); return { supabase: client, clinicId, role: 'owner', clinicName: '隔離品牌' }; }, canViewSensitiveCustomerData: () => true },
    '@/lib/admin-display': { auditStatusLabel: value => value },
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => enabled },
    './actions': { createDiscountCodeAction: () => {}, grantPatientMembershipAction: () => {}, redeemPatientMembershipAction: () => {}, saveMembershipPlanAction: () => {}, toggleDiscountCodeAction: () => {}, toggleMembershipPlanAction: () => {} },
    './MembershipPlanDesigner': { MembershipPlanDesigner: ({ plans: itemPlans, services: itemServices }) => jsx.jsx('div', { children: `designer:${itemPlans.length}:${itemServices.length}` }) },
    './MembershipPatientPicker': { MembershipPatientPicker: () => jsx.jsx('p', { children: '搜尋顧客後選擇' }) },
    '@/components/admin/ManagementTabs': { MembershipManagementTabs: () => null },
  });
  return { page, calls };
}

test('membership page renders row 1001 from all four sources without preloading patients', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /啟用方案<\/span><strong[^>]*>1001<\/strong>/);
  assert.match(html, /啟用優惠<\/span><strong[^>]*>1001<\/strong>/);
  assert.match(html, /使用中套票<\/span><strong[^>]*>1001<\/strong>/);
  assert.match(html, /未使用堂數<\/span><strong[^>]*>2,002<\/strong>/);
  assert.match(html, /designer:1001:1001/);
  assert.match(html, /CODE1000/);
  assert.match(html, /PASS1000/);
  assert.match(html, /顧客 1000/);
  const redeemSelect = html.slice(html.indexOf('name="membership_id"'), html.indexOf('</select>', html.indexOf('name="membership_id"')));
  assert.match(redeemSelect, /顧客 1000 · 套票 1000 · 剩 2 次/);
  assert.ok(!redeemSelect.includes('顧客 999'));
  assert.match(html, /搜尋顧客後選擇/);
  assert.ok(!f.calls.some(call => call.table === 'patients'));
  for (const table of ['membership_plans', 'services', 'discount_codes', 'patient_memberships']) {
    const calls = f.calls.filter(call => call.table === table);
    assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999]]);
    assert.ok(calls.every(call => call.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === clinicId)));
    assert.ok(calls.every(call => call.orders.includes('id')));
    assert.ok(calls.every(call => !call.projection.includes('*')));
  }
});

for (const table of ['membership_plans', 'services', 'discount_codes', 'patient_memberships']) {
  test(`membership page fails closed when ${table} page two fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.page.default(), error => {
      assert.match(error.message, /目前無法確認操作結果/);
      assert.ok(!error.message.includes(privateError));
      return true;
    });
  });
}

test('membership page avoids all table reads when module is disabled', async () => {
  const f = fixture({ enabled: false });
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /模組未啟用/);
  assert.equal(f.calls.length, 0);
});

test('membership page denies unauthorised role before table reads', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page.default(), /DENIED/);
  assert.equal(f.calls.length, 0);
});

test('membership patient picker requires an explicit searched patient selection', () => {
  const picker = load('components/admin/PatientPicker.tsx', {
    'react/jsx-runtime': jsx,
    react: React,
  });
  const component = load('app/admin/memberships/MembershipPatientPicker.tsx', {
    '@/components/admin/PatientPicker': picker,
  });
  const html = renderToStaticMarkup(jsx.jsx(component.MembershipPatientPicker, {}));
  assert.match(html, /type="search"/);
  assert.match(html, /name="patient_id"/);
  assert.match(html, /required=""/);
  assert.match(html, /請先搜尋並選擇顧客/);
  assert.ok(!html.includes('0900'));
});

test('patient search API hides database errors in both ordinary and birthday queries', async () => {
  for (const keyword of ['amy', '0308']) {
    const calls = [];
    const client = { from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const query = new Proxy({}, { get(_target, key) {
        if (key === 'then') return (resolve, reject) => Promise.resolve(
          keyword === '0308' && calls.length === 1
            ? { data: [], error: null }
            : { data: null, error: { message: privateError } },
        ).then(resolve, reject);
        return (...args) => { if (key === 'eq') call.filters.push(args); return query; };
      } });
      return query;
    } };
    const route = load('app/api/admin/patients/search/route.ts', {
      '@/lib/admin': { requireMember: async () => ({ supabase: client, clinicId, role: 'owner' }), canViewSensitiveCustomerData: () => true },
      '@/lib/http': { ok: data => ({ ok: true, data }), fail: (message, status) => ({ ok: false, message, status }) },
    });
    const result = await route.GET({ nextUrl: { searchParams: new URL(`https://example.test?q=${keyword}`).searchParams } });
    assert.equal(result.status, 500);
    assert.match(result.message, /讀取顧客失敗/);
    assert.ok(!result.message.includes(privateError));
    assert.ok(calls.every(call => call.table === 'patients' && call.filters.some(([column, value]) => column === 'clinic_id' && value === clinicId)));
  }
});
