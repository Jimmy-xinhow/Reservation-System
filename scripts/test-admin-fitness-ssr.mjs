import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fitness-brand';
const privateError = 'PRIVATE_FITNESS_DB_SECRET';
const queryBoundary = { adminQuery: async value => await value, adminErrorMessage: () => '目前無法確認操作結果' };

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency: ${name}`);
  }, Date, Intl });
  return exports;
}

const pagination = load('lib/supabase-pagination.ts', { 'server-only': {}, '@/lib/admin-query': queryBoundary });
const Link = ({ children, href }) => jsx.jsx('a', { href, children });

function fixture({ role = 'owner', deny = false, failTable = '' } = {}) {
  const calls = [];
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const sessions = Array.from({ length: 1001 }, (_, i) => ({ id: `session-${i}`, clinic_id: clinicId, active: true, name: `班次 ${i}`, start_at: future, end_at: future, venue: '教室', capacity: 1100, events: { title: `課程 ${i}` } }));
  const subscriptions = Array.from({ length: 1001 }, (_, i) => ({ id: `subscription-${i}`, clinic_id: clinicId, status: 'active', current_period_end: null, next_billing_at: null, patients: { name: `會員 ${i}`, phone: '0912345678' }, subscription_plans: { name: '月費', billing_interval: 'monthly' }, created_at: future }));
  const registrations = Array.from({ length: 1001 }, (_, i) => ({ id: `registration-${i}`, clinic_id: clinicId, session_id: 'session-1000', status: i === 1000 ? 'waitlisted' : 'confirmed' }));
  registrations.push({ id: 'foreign-registration', clinic_id: 'foreign-brand', session_id: 'session-1000', status: 'confirmed' });
  const freezes = Array.from({ length: 101 }, (_, i) => ({ id: `freeze-${i}`, clinic_id: clinicId, starts_on: '2026-09-24', ends_on: '2026-09-25', freeze_days: 1, status: 'scheduled', reason: `原因 ${i}`, patients: { name: '會員' }, patient_subscriptions: { subscription_plans: { name: '月費' } }, created_at: future }));
  const rows = { event_sessions: sessions, registrations, patient_subscriptions: subscriptions, subscription_freezes: freezes };
  const client = { from(table) {
    const call = { table, projection: '', filters: [], orders: [], range: null, limit: null };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && (call.range?.[0] === 1000 || table === 'subscription_freezes')) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        let data = rows[table] ?? [];
        for (const [kind, column, value] of call.filters) {
          if (kind === 'eq') data = data.filter(row => row[column] === value);
          if (kind === 'in') data = data.filter(row => value.includes(row[column]));
          if (kind === 'gte') data = data.filter(row => row[column] >= value);
          if (kind === 'lte') data = data.filter(row => row[column] <= value);
        }
        const [from, to] = call.range ?? [0, (call.limit ?? 1000) - 1];
        return Promise.resolve({ data: data.slice(from, to + 1), error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (['eq', 'in', 'gte', 'lte'].includes(key)) call.filters.push([key, ...args]);
        if (key === 'order') call.orders.push(args[0]);
        if (key === 'range') call.range = args;
        if (key === 'limit') call.limit = args[0];
        return query;
      };
    } });
    return query;
  } };
  const page = load('app/admin/fitness/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: Link },
    '@/lib/admin': { requireNonProvider: async () => { if (deny) throw Error('DENIED'); return { role, clinicId }; }, canViewSensitiveCustomerData: value => value !== 'staff' },
    '@/lib/supabase-server': { createSupabaseServer: async () => client },
    '@/lib/admin-query': queryBoundary,
    '@/lib/supabase-pagination': pagination,
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    './actions': { freezeSubscriptionAction: () => {} },
  });
  return { page, calls };
}

test('fitness page includes 1001st session and subscription with exact registration totals', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /班次 1000/);
  assert.match(html, /會員 1000/);
  assert.match(html, /1000／1100/);
  assert.match(html, /候補 1/);
  assert.match(html, /選擇會籍/);
  assert.ok(!html.includes('原因 100'));
  for (const table of ['event_sessions', 'patient_subscriptions']) {
    const calls = f.calls.filter(call => call.table === table);
    assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999]]);
    assert.ok(calls.every(call => call.orders.includes('id') && call.filters.some(([kind, column, value]) => kind === 'eq' && column === 'clinic_id' && value === clinicId)));
  }
  const registrationCalls = f.calls.filter(call => call.table === 'registrations');
  assert.ok(registrationCalls.length >= 12);
  assert.ok(registrationCalls.every(call => call.filters.some(([kind, column, value]) => kind === 'eq' && column === 'clinic_id' && value === clinicId) && call.filters.some(([kind, column, value]) => kind === 'in' && column === 'session_id' && value.length <= 100)));
  assert.ok(registrationCalls.some(call => call.range?.[0] === 1000));
});

for (const table of ['event_sessions', 'registrations', 'patient_subscriptions', 'subscription_freezes']) {
  test(`fitness page fails closed when ${table} query fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.page.default(), error => error.message.includes('目前無法確認操作結果') && !error.message.includes(privateError));
  });
}

test('staff without PII permission and denied role do not read tenant data', async () => {
  const staff = fixture({ role: 'staff' });
  assert.match(renderToStaticMarkup(await staff.page.default()), /目前角色不能查看顧客會籍/);
  assert.equal(staff.calls.length, 0);
  const denied = fixture({ deny: true });
  await assert.rejects(() => denied.page.default(), /DENIED/);
  assert.equal(denied.calls.length, 0);
});
