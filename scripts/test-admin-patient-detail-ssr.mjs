import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const canary = 'PRIVATE_PATIENT_DETAIL_CANARY';
function load(path, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(source, {exports, Error, Date, Intl, console, require: name => deps[name] ?? {} });
  return exports;
}

function harness({fault = '', thrown = false, denied = false, permitted = true, manager = true, missing = false, factoryFault = false, storedFollowupError = null} = {}) {
  const queries = [], boundary = [];
  const redirect = Error('NEXT_REDIRECT');
  let factories = 0;
  const rows = {
    patients: {id: 'patient', name: 'Test Customer', phone: '0900000000', tags: null, birthday: null, gender: null, email: null, marketing_opt_in: false, blocked_until: null, private: canary},
    appointments: [{id: 'appt', start_at: '2026-09-23T04:00:00Z', status: 'booked', queue_number: null, doctors: {name: 'Provider'}, services: {name: 'Service'}, private: canary}],
    patient_records: [{id: 'record', content: 'Approved note', created_at: '2026-09-23T01:00:00Z', private: canary}],
    crm_interactions: [{id: 'interaction', kind: 'note', channel: null, title: 'Approved interaction', body: 'Approved body', created_at: '2026-09-23T01:00:00Z', private: canary}],
    customer_wallets: {balance: 25, lifetime_credit: 30, lifetime_debit: 5, private: canary},
    loyalty_accounts: {points_balance: 12, lifetime_earned: 15, lifetime_redeemed: 3, private: canary},
    patient_subscriptions: [], scheduled_followups: storedFollowupError ? [{id: 'followup', channel: 'line', body: 'Approved followup', scheduled_for: '2026-09-23T01:00:00Z', status: 'failed', last_error: storedFollowupError}] : [],
  };
  const service = {from(table) {
    const filters = []; const query = {table, filters}; queries.push(query);
    const q = new Proxy({}, {get: (_, key) => key === 'then'
      ? (yes, no) => Promise.resolve().then(() => {
        const target = table;
        if (fault === target) {
          if (thrown) throw Error(canary);
          return {data: null, error: {message: canary, code: 'XX000'}};
        }
        return {data: target === 'merge_targets' ? [] : missing && table === 'patients' ? null : rows[table], error: null};
      }).then(yes, no)
      : (...args) => {filters.push([key, ...args]); return q;}});
    return q;
  }};
  const component = name => props => {boundary.push({name, props}); return null;};
  const deps = {
    'react/jsx-runtime': jsx,
    'next/link': {default: ({href, children}) => jsx.jsx('a', {href, children})},
    '@/lib/admin': {
      requireMember: async () => {if (denied) throw redirect; return {clinicId: 'brand', role: 'admin'};},
      canViewSensitiveCustomerData: () => permitted,
      hasBrandPermission: () => manager,
    },
    '@/lib/supabase-server': {createSupabaseServer: async () => {factories++; if (factoryFault) throw Error(canary); return service;}},
    '@/lib/slots': {formatDateTime: value => String(value)},
    '@/components/SubmitButton': {SubmitButton: component('SubmitButton')},
    '../../followups/FollowupComposer': {default: component('FollowupComposer')},
    './MergePatientForm': {default: component('MergePatientForm')},
    '../../patient-actions': new Proxy({}, {get: () => '/fixture-action'}),
    '../../followups/actions': new Proxy({}, {get: () => '/fixture-action'}),
  };
  deps['@/lib/error-category'] = load('lib/error-category.ts', deps);
  deps['./error-category'] = deps['@/lib/error-category'];
  deps['@/lib/delivery-error'] = load('lib/delivery-error.ts', deps);
  deps['@/lib/admin-query'] = load('lib/admin-query.ts', deps);
  const page = load('app/admin/patients/[id]/page.tsx', deps);
  return {queries, boundary, redirect, factories: () => factories, async run() {
    return renderToStaticMarkup(await page.default({params: Promise.resolve({id: 'patient'})}));
  }};
}

test('patient detail returns the missing-customer state only for a successful empty lookup', async () => {
  const h = harness({missing: true});
  assert.match(await h.run(), /查無此顧客/);
  assert.equal(h.queries.length, 1);
});
test('patient detail preserves auth redirect and sensitive-data role gate before DB reads', async () => {
  const denied = harness({denied: true});
  await assert.rejects(denied.run(), error => error === denied.redirect);
  assert.equal(denied.factories(), 0);
  const restricted = harness({permitted: false});
  assert.match(await restricted.run(), /沒有查看完整顧客資料的權限/);
  assert.equal(restricted.factories(), 0);
});
test('patient detail successful state uses clinic and patient scopes with selected columns', async () => {
  const h = harness(); const html = await h.run();
  assert.match(html, /Test Customer/);
  assert.match(html, /NT\$25/);
  assert.match(html, /Approved note/);
  assert.ok(!html.includes(canary));
  assert.ok(!JSON.stringify(h.boundary).includes(canary));
  assert.equal(h.queries.length, 8);
  for (const query of h.queries) {
    assert.ok(query.filters.some(f => f[0] === 'eq' && f[1] === 'clinic_id' && f[2] === 'brand'), query.table);
    assert.ok(query.filters.some(f => f[0] === 'select' && typeof f[1] === 'string' && !f[1].includes('*')), query.table);
    if (query.table !== 'patients') assert.ok(query.filters.some(f => f[0] === 'eq' && f[1] === 'patient_id' && f[2] === 'patient'), query.table);
  }
});
test('merge form is only offered to brand management and does not preload other patients', async () => {
  const manager = harness(); await manager.run();
  assert.equal(manager.boundary.filter(item => item.name === 'MergePatientForm').length, 1);
  assert.equal(manager.queries.filter(q => q.table === 'patients').length, 1);
  const staff = harness({manager: false}); await staff.run();
  assert.equal(staff.boundary.filter(item => item.name === 'MergePatientForm').length, 0);
  assert.equal(staff.queries.filter(q => q.table === 'patients').length, 1);
});
test('patient detail classifies a historical raw followup error before rendering', async () => {
  const html = await harness({storedFollowupError: 'fetch failed phone=0912345678 Authorization=Bearer private-token'}).run();
  assert.ok(!html.includes('private-token'));
  assert.match(html, /delivery_error:connection/);
});
for (const fault of ['patients', 'appointments', 'patient_records', 'crm_interactions', 'customer_wallets', 'loyalty_accounts', 'patient_subscriptions', 'scheduled_followups']) {
  for (const thrown of [false, true]) test(`${fault} ${thrown ? 'throw' : 'returned error'} cannot appear as empty customer data`, async () => {
    const h = harness({fault, thrown});
    await assert.rejects(h.run(), error => {
      assert.match(error.message, /目前無法確認/);
      assert.ok(!error.message.includes(canary));
      assert.ok(!error.stack.includes(canary));
      return true;
    });
  });
}
test('database client factory failure is sanitized', async () => {
  const h = harness({factoryFault: true});
  await assert.rejects(h.run(), error => error.message.includes('目前無法確認') && !error.stack.includes(canary));
});
