import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const brand = 'fixture-brand';
const privateError = 'PRIVATE_COMMISSION_DB_ERROR';
const safeError = '目前無法確認操作結果';
const now = '2026-10-31T16:30:00.000Z'; // 2026-11-01 00:30 in Taipei.
const monthStart = '2026-10-31T16:00:00.000Z';

function loadModule(file, dependencies, context = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw Error(`Unexpected dependency: ${name}`);
    },
    ...context,
  });
  return exports;
}

function makeFixture({ failSecondPage = false, deny = false } = {}) {
  const calls = [];
  let factoryCalls = 0;
  const rows = {
    doctors: [{ id: 'doctor-1', name: '測試服務人員', clinic_id: brand, active: true }],
    services: [{ id: 'service-1', name: '測試服務', price: 100, clinic_id: brand, active: true }],
    beauty_commission_rules: [{ id: 'rule-1', doctor_id: 'doctor-1', service_id: 'service-1', amount_per_service: 1, calculation_type: 'fixed', rate_percent: 0, doctors: { name: '測試服務人員' }, services: { name: '測試服務', price: 100 }, clinic_id: brand, active: true }],
    appointments: [
      { id: 'prior-month', doctor_id: 'doctor-1', service_id: 'service-1', clinic_id: brand, status: 'done', start_at: '2026-10-31T15:59:59.000Z' },
      { id: 'other-brand', doctor_id: 'doctor-1', service_id: 'service-1', clinic_id: 'other-brand', status: 'done', start_at: monthStart },
      { id: 'not-done', doctor_id: 'doctor-1', service_id: 'service-1', clinic_id: brand, status: 'booked', start_at: monthStart },
      ...Array.from({ length: 1001 }, (_, index) => ({ id: `done-${String(index).padStart(4, '0')}`, doctor_id: 'doctor-1', service_id: 'service-1', clinic_id: brand, status: 'done', start_at: monthStart })),
    ],
  };
  const client = {
    from(table) {
      const call = { table, projection: '', filters: [], order: [], range: null };
      calls.push(call);
      const query = new Proxy({}, {
        get(_target, key) {
          if (key === 'then') return (resolve, reject) => {
            if (failSecondPage && table === 'appointments' && call.range?.[0] === 1000) {
              return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
            }
            let result = rows[table] ?? [];
            for (const [method, column, value] of call.filters) {
              if (method === 'eq') result = result.filter(row => row[column] === value);
              if (method === 'gte') result = result.filter(row => row[column] >= value);
            }
            const [from, to] = call.range ?? [0, 999];
            return Promise.resolve({ data: result.slice(from, to + 1), error: null }).then(resolve, reject);
          };
          return (...args) => {
            if (key === 'select') call.projection = args[0];
            if (key === 'eq' || key === 'gte') call.filters.push([key, ...args]);
            if (key === 'order') call.order.push(args[0]);
            if (key === 'range') call.range = args;
            return query;
          };
        },
      });
      return query;
    },
  };
  const adminQuery = async promise => await promise;
  const pagination = loadModule('lib/supabase-pagination.ts', {
    'server-only': {},
    '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
  });
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  };
  const page = loadModule('app/admin/operations/commissions/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase-pagination': pagination,
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/lib/admin': { requireNonProvider: async () => { if (deny) throw Error('DENIED'); return { clinicId: brand }; } },
    '@/lib/supabase': { createServiceClient: () => { factoryCalls++; return client; } },
    '../../beauty/actions': { saveCommissionRuleAction: () => {} },
  }, { Date: FixedDate });
  return { page, calls, factoryCalls: () => factoryCalls };
}

test('commission page includes appointment 1001 and uses Taipei month boundary', async () => {
  const fixture = makeFixture();
  const html = renderToStaticMarkup(await fixture.page.default());
  assert.match(html, /本月完成 1001 次服務/);
  assert.match(html, /\$1,001/);
  assert.ok(!html.includes('PRIVATE_'));
  const appointmentCalls = fixture.calls.filter(call => call.table === 'appointments');
  assert.deepEqual(appointmentCalls.map(call => call.range), [[0, 999], [1000, 1999]]);
  assert.ok(appointmentCalls.every(call => call.filters.some(([method, column, value]) => method === 'gte' && column === 'start_at' && value === monthStart)));
  assert.ok(fixture.calls.every(call => call.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === brand)));
  assert.ok(fixture.calls.every(call => call.order.includes('id')));
  assert.ok(fixture.calls.every(call => !call.projection.includes('*')));
});

test('commission page fails closed when appointment page two fails', async () => {
  const fixture = makeFixture({ failSecondPage: true });
  await assert.rejects(() => fixture.page.default(), error => {
    assert.match(error.message, /目前無法確認操作結果/);
    assert.ok(!error.message.includes(privateError));
    return true;
  });
});

test('commission page rejects role before service client creation', async () => {
  const fixture = makeFixture({ deny: true });
  await assert.rejects(() => fixture.page.default(), /DENIED/);
  assert.equal(fixture.factoryCalls(), 0);
  assert.equal(fixture.calls.length, 0);
});
