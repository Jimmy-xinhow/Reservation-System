import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fixture-brand';
const privateError = 'PRIVATE_CUSTOMER_DB_SECRET';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency: ${name}`);
  }, Date, Intl, Headers });
  return exports;
}

const queryBoundary = { adminQuery: async promise => await promise, adminErrorMessage: () => '目前無法確認操作結果' };
const pagination = load('lib/supabase-pagination.ts', { 'server-only': {}, '@/lib/admin-query': queryBoundary });
const PatientPicker = () => jsx.jsx('span', { children: '搜尋顧客後選擇' });
const SubmitButton = ({ children, disabled }) => jsx.jsx('button', { disabled, children });
const Link = ({ children, href }) => jsx.jsx('a', { href, children });

function fixture({ role = 'owner', deny = false, failTable = '' } = {}) {
  const calls = [];
  const patients = Array.from({ length: 1001 }, (_, i) => ({ id: `patient-${i}`, name: `顧客 ${i}`, phone: '0912345678' }));
  const wallets = patients.map((patient, i) => ({ id: `wallet-${i}`, clinic_id: clinicId, balance: 1, lifetime_credit: 1, lifetime_debit: 0, updated_at: '2026-09-23', patients: patient }));
  const points = patients.map((patient, i) => ({ id: `points-${i}`, clinic_id: clinicId, points_balance: 2, lifetime_earned: 2, lifetime_redeemed: 0, updated_at: '2026-09-23', patients: patient }));
  const plans = patients.map((_, i) => ({ id: `plan-${i}`, clinic_id: clinicId, name: `方案 ${i}`, description: null, price: 100, billing_interval: 'monthly', included_credits: 1, benefits: [], active: true, created_at: '2026-09-23' }));
  const subscriptions = patients.map((patient, i) => ({ id: `subscription-${i}`, clinic_id: clinicId, status: 'active', current_period_end: null, next_billing_at: null, note: null, created_at: '2026-09-23', patients: patient, subscription_plans: { id: `plan-${i}`, name: `方案 ${i}`, billing_interval: 'monthly' } }));
  const templates = patients.map((_, i) => ({ id: `template-${i}`, clinic_id: clinicId, name: `範本 ${i}`, kind: 'consent', version: 1, active: true, created_at: '2026-09-23' }));
  const requests = Array.from({ length: 101 }, (_, i) => ({ id: `request-${i}`, clinic_id: clinicId, status: 'signed', expires_at: '2026-10-23', signer_name: null, signed_at: '2026-09-23', created_at: '2026-09-23', patients: patients[i], document_templates: { name: `範本 ${i}`, kind: 'consent', version: 1 } }));
  const followups = patients.map((patient, i) => ({ id: `followup-${i}`, clinic_id: clinicId, patient_id: patient.id, channel: 'manual', purpose: 'service', subject: `回訪 ${i}`, body: '合成內容', scheduled_for: '2026-09-23T04:00:00.000Z', status: 'pending', attempt_count: 0, last_error: null, processed_at: null, patients: { name: patient.name, phone: patient.phone, email: null } }));
  followups.push({ ...followups[0], id: 'foreign-followup', clinic_id: 'foreign-brand', subject: 'FOREIGN_MARKER' });
  const rows = { patients, customer_wallets: wallets, loyalty_accounts: points, subscription_plans: plans, patient_subscriptions: subscriptions, document_templates: templates, customer_document_requests: requests, scheduled_followups: followups };
  const client = { from(table) {
    const call = { table, projection: '', filters: [], orders: [], range: null, limit: null };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && (call.range?.[0] === 1000 || table === 'customer_document_requests')) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        let data = rows[table] ?? [];
        for (const [kind, column, value] of call.filters) if (kind === 'eq') data = data.filter(row => row[column] === value);
        const [from, to] = call.range ?? [0, (call.limit ?? 1000) - 1];
        return Promise.resolve({ data: data.slice(from, to + 1), error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (key === 'eq') call.filters.push([key, ...args]);
        if (key === 'order') call.orders.push(args[0]);
        if (key === 'range') call.range = args;
        if (key === 'limit') call.limit = args[0];
        return query;
      };
    } });
    return query;
  } };
  const member = { supabase: client, clinicId, role };
  const auth = { requireNonProvider: async () => { if (deny) throw Error('DENIED'); return member; }, canViewSensitiveCustomerData: value => value !== 'staff', hasBrandPermission: () => true };
  const common = {
    'react/jsx-runtime': jsx,
    'next/link': { default: Link },
    '@/lib/admin': auth,
    '@/lib/supabase-server': { createSupabaseServer: async () => client },
    '@/lib/supabase-pagination': pagination,
    '@/lib/admin-query': queryBoundary,
    '@/components/admin/PatientPicker': { PatientPicker },
    '@/components/SubmitButton': { SubmitButton },
  };
  const customer = load('app/admin/customer-value/page.tsx', { ...common, './actions': { adjustPointsAction: () => {}, adjustWalletAction: () => {}, createPatientSubscriptionAction: () => {}, createSubscriptionPlanAction: () => {}, setPatientSubscriptionStatusAction: () => {}, toggleSubscriptionPlanAction: () => {} }, '@/components/admin/ManagementTabs': { MembershipManagementTabs: () => null } });
  const documents = load('app/admin/documents/page.tsx', { ...common, 'next/headers': { headers: async () => new Headers({ host: 'example.test' }) }, './actions': { cancelDocumentRequestAction: () => {}, createDocumentTemplateAction: () => {}, issueDocumentRequestAction: () => {} } });
  const followupPage = load('app/admin/followups/page.tsx', { ...common, './actions': { createScheduledFollowupAction: () => {}, setScheduledFollowupStatusAction: () => {} }, './FollowupComposer': { default: () => jsx.jsx('p', { children: '搜尋顧客後選擇' }) }, '@/lib/delivery-error': { deliveryError: () => '安全錯誤類別' } });
  return { customer, documents, followupPage, calls };
}

function paged(calls, table) { return calls.filter(call => call.table === table).map(call => call.range); }

test('customer value sums all 1001 rows from four sources without preloading patient directory', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.customer.default());
  assert.match(html, /NT\$1,001/);
  assert.match(html, /2,002/);
  assert.match(html, /顧客 1000/);
  assert.match(html, /方案 1000/);
  assert.match(html, /搜尋顧客後選擇/);
  assert.ok(!f.calls.some(call => call.table === 'patients'));
  for (const table of ['customer_wallets', 'loyalty_accounts', 'subscription_plans', 'patient_subscriptions']) {
    const calls = f.calls.filter(call => call.table === table);
    assert.deepEqual(paged(f.calls, table), [[0, 999], [1000, 1999]]);
    assert.ok(calls.every(call => call.orders.includes('id') && call.filters.some(([kind, column, value]) => kind === 'eq' && column === 'clinic_id' && value === clinicId)));
  }
});

test('documents include template 1001 and preserve explicit recent 100 requests without patient preload', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.documents.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /範本 1000/);
  assert.match(html, /搜尋顧客後選擇/);
  assert.ok(!html.includes('顧客 100'));
  assert.deepEqual(paged(f.calls, 'document_templates'), [[0, 999], [1000, 1999]]);
  assert.equal(f.calls.find(call => call.table === 'customer_document_requests')?.limit, 100);
  assert.ok(!f.calls.some(call => call.table === 'patients'));
});

test('followup totals and list include the 1001st scoped row without patient preload', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.followupPage.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /回訪 1000/);
  assert.match(html, /待處理<\/span><strong[^>]*>1001<\/strong>/);
  assert.ok(!html.includes('FOREIGN_MARKER'));
  assert.ok(!f.calls.some(call => call.table === 'patients'));
  assert.deepEqual(paged(f.calls, 'scheduled_followups'), [[0, 999], [1000, 1999]]);
});

for (const table of ['customer_wallets', 'loyalty_accounts', 'subscription_plans', 'patient_subscriptions']) {
  test(`customer value fails closed when ${table} page two fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.customer.default(), error => error.message.includes('目前無法確認操作結果') && !error.message.includes(privateError));
  });
}

for (const table of ['document_templates', 'customer_document_requests']) {
  test(`documents fail closed when ${table} query fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.documents.default({ searchParams: Promise.resolve({}) }), error => error.message.includes('目前無法確認操作結果') && !error.message.includes(privateError));
  });
}

test('followups fail closed when second page fails', async () => {
  const f = fixture({ failTable: 'scheduled_followups' });
  await assert.rejects(() => f.followupPage.default({ searchParams: Promise.resolve({}) }), /讀取回訪資料失敗/);
});

test('staff without customer-data permission and denied roles do not query private tables', async () => {
  for (const page of ['customer', 'documents', 'followupPage']) {
    const staff = fixture({ role: 'staff' });
    const html = renderToStaticMarkup(await staff[page].default({ searchParams: Promise.resolve({}) }));
    assert.match(html, /目前角色不能查看顧客/);
    assert.equal(staff.calls.length, 0);
    const denied = fixture({ deny: true });
    await assert.rejects(() => denied[page].default({ searchParams: Promise.resolve({}) }), /DENIED/);
    assert.equal(denied.calls.length, 0);
  }
});
