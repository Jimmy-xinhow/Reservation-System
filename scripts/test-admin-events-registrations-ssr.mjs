import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fixture-brand';
const otherId = 'other-brand';
const privateError = 'PRIVATE_REGISTRATION_DB_SECRET';
const eventId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require: name => {
      if (name in deps) return deps[name];
      throw Error(`Unexpected dependency: ${name}`);
    },
    Response, URLSearchParams, URL, Date, Intl,
  });
  return exports;
}

const pagination = load('lib/supabase-pagination.ts', {
  'server-only': {},
  '@/lib/admin-query': {
    adminQuery: async promise => await promise,
    adminErrorMessage: () => '目前無法確認操作結果',
  },
});

function fixture({ failTable = '', role = 'owner', deny = false, enabled = true } = {}) {
  const calls = [];
  const created_at = '2026-09-23T04:00:00.000Z';
  const events = Array.from({ length: 1001 }, (_, i) => ({ id: i === 1000 ? eventId : `event-${i}`, clinic_id: clinicId, slug: `event-${i}`, title: `活動 ${i}`, description: null, status: 'draft', access_mode: 'public', created_at }));
  const sessions = Array.from({ length: 1001 }, (_, i) => ({ id: i === 1000 ? sessionId : `session-${i}`, clinic_id: clinicId, event_id: i === 1000 ? eventId : `event-${i}`, name: `場次 ${i}`, start_at: created_at, end_at: created_at, venue: null, capacity: 20, waitlist_enabled: true }));
  const tickets = Array.from({ length: 1001 }, (_, i) => ({ id: `ticket-${i}`, clinic_id: clinicId, event_id: i === 1000 ? eventId : `event-${i}`, name: `票種 ${i}`, price: 0, capacity: null, membership_plan_id: null, sale_start_at: null, sale_end_at: null, active: true }));
  const forms = Array.from({ length: 1001 }, (_, i) => ({ id: `form-${i}`, clinic_id: clinicId, event_id: i === 1000 ? eventId : `event-${i}`, version: 1, status: 'published' }));
  const fields = Array.from({ length: 1001 }, (_, i) => ({ id: `field-${i}`, clinic_id: clinicId, form_id: `form-${i}`, field_key: `key-${i}`, label: `欄位 ${i}`, field_type: 'text', required: false, options: [], sort_order: i }));
  const memberships = Array.from({ length: 1001 }, (_, i) => ({ id: `plan-${i}`, clinic_id: clinicId, name: `方案 ${i}`, credits_total: 3, active: true }));
  const registrations = Array.from({ length: 1001 }, (_, i) => ({ id: `registration-${String(i).padStart(4, '0')}`, clinic_id: clinicId, event_id: eventId, session_id: sessionId, registration_no: `REG${i}`, status: 'confirmed', payment_status: 'paid', amount: 100, discount_amount: 0, membership_id: null, name: i === 1000 ? '=FORMULA' : `顧客 ${i}`, phone: '0912345678', email: 'private@example.invalid', created_at, events: { title: '活動 1000' }, event_sessions: { name: '場次 1000', start_at: created_at } }));
  registrations.push({ ...registrations[0], id: 'foreign-registration', clinic_id: otherId, registration_no: 'FOREIGN_MARKER' });
  const rows = { events, event_sessions: sessions, event_ticket_types: tickets, registration_forms: forms, registration_form_fields: fields, membership_plans: memberships, registrations, clinics: [{ id: clinicId, slug: 'fixture' }] };
  const client = { from(table) {
    const call = { table, projection: '', filters: [], orders: [], range: null, single: false };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && call.range?.[0] === 1000) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        let data = rows[table] ?? [];
        for (const [method, column, value] of call.filters) {
          if (method === 'eq') data = data.filter(row => row[column] === value);
          if (method === 'gte') data = data.filter(row => row[column] >= value);
          if (method === 'lt') data = data.filter(row => row[column] < value);
          if (method === 'or' && !String(column).includes('REG')) data = [];
        }
        for (const [column, options] of [...call.orders].reverse()) data = [...data].sort((a, b) => options?.ascending === false ? String(b[column]).localeCompare(String(a[column])) : String(a[column]).localeCompare(String(b[column])));
        const [from, to] = call.range ?? [0, 999];
        const result = call.single ? data[0] ?? null : data.slice(from, to + 1).map(row => {
          if (table !== 'registrations' || call.projection.includes('name, phone, email')) return row;
          const { name, phone, email, ...safe } = row;
          return safe;
        });
        return Promise.resolve({ data: result, error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (key === 'eq' || key === 'gte' || key === 'lt' || key === 'or') call.filters.push([key, ...args]);
        if (key === 'order') call.orders.push(args);
        if (key === 'range') call.range = args;
        if (key === 'maybeSingle') call.single = true;
        return query;
      };
    } });
    return query;
  } };
  const auth = { requireNonProvider: async () => { if (deny) throw Error('DENIED'); return { supabase: client, clinicId, role }; }, canViewSensitiveCustomerData: value => value !== 'staff', canOperate: () => true };
  const common = {
    'react/jsx-runtime': jsx,
    '@/lib/admin': auth,
    '@/lib/admin-query': { adminQuery: async promise => await promise, adminErrorMessage: () => '目前無法確認操作結果' },
    '@/lib/supabase-pagination': pagination,
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => enabled },
    '@/components/ModuleDisabled': { ModuleDisabled: () => jsx.jsx('p', { children: '模組未啟用' }) },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/lib/registration': { formatAmount: value => String(value), formatEventDate: value => String(value), paymentStatusLabel: value => value, registrationStatusLabel: value => value },
    './actions': { createEventAction: () => {}, createEventSessionAction: () => {}, createTicketTypeAction: () => {}, regeneratePrivateEventLinkAction: () => {}, setEventStatusAction: () => {}, addRegistrationFieldAction: () => {}, cancelRegistrationAdminAction: () => {}, markRegistrationNoShowAction: () => {} },
  };
  const eventsPage = load('app/admin/events/page.tsx', common);
  const registrationsPage = load('app/admin/registrations/page.tsx', { ...common, 'next/link': { default: ({ children, href }) => jsx.jsx('a', { href, children }) }, '@/lib/supabase-server': { createSupabaseServer: async () => client } });
  const route = load('app/api/admin/registrations/route.ts', {
    '@/lib/admin': auth,
    '@/lib/supabase-server': { createSupabaseServer: async () => client },
    '@/lib/supabase-pagination': pagination,
    '@/lib/http': { fail: (message, status) => Response.json({ ok: false, message }, { status }) },
  });
  return { eventsPage, registrationsPage, route, calls };
}

const params = { registered_from: '2026-09-23', registered_to: '2026-09-23' };
const url = 'https://example.test/api/admin/registrations?registered_from=2026-09-23&registered_to=2026-09-23';
function request(suffix = '') { return { nextUrl: new URL(url + suffix) }; }
function paged(calls, table) { return calls.filter(call => call.table === table).map(call => call.range); }

test('events page renders 1001st event and all six dependent sources with stable tenant pagination', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.eventsPage.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /活動 1000/);
  assert.match(html, /場次 1000/);
  assert.match(html, /票種 1000/);
  assert.match(html, /欄位 1000/);
  assert.match(html, /方案 1000/);
  for (const table of ['events', 'event_sessions', 'event_ticket_types', 'registration_forms', 'registration_form_fields', 'membership_plans']) {
    assert.deepEqual(paged(f.calls, table), [[0, 999], [1000, 1999]]);
    assert.ok(f.calls.filter(call => call.table === table).every(call => call.filters.some(([kind, col, val]) => kind === 'eq' && col === 'clinic_id' && val === clinicId) && call.orders.some(([col]) => col === 'id')));
  }
});

test('registration list and CSV include row 1001 and exclude foreign tenant', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.registrationsPage.default({ searchParams: Promise.resolve(params) }));
  assert.match(html, /此場次 1001 筆/);
  assert.match(html, /REG1000/);
  const response = await f.route.GET(request('&format=csv'));
  const csv = await response.text();
  assert.equal(response.status, 200);
  assert.equal(csv.trim().split('\r\n').length, 1002);
  assert.match(csv, /REG1000/);
  assert.match(csv, /'=FORMULA/);
  assert.ok(!csv.includes('FOREIGN_MARKER'));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  for (const table of ['events', 'event_sessions', 'registrations']) assert.ok(paged(f.calls, table).some(([from]) => from === 1000));
});

test('staff role never selects or exports PII and cannot search by name or phone', async () => {
  const f = fixture({ role: 'staff' });
  const html = renderToStaticMarkup(await f.registrationsPage.default({ searchParams: Promise.resolve({ ...params, q: 'REG' }) }));
  assert.match(html, /聯絡資料已遮蔽/);
  assert.ok(!html.includes('0912345678'));
  const response = await f.route.GET(request('&q=REG&format=csv'));
  const csv = await response.text();
  assert.ok(!csv.includes('0912345678'));
  assert.ok(!csv.includes('private@example.invalid'));
  assert.ok(f.calls.filter(call => call.table === 'registrations').every(call => !call.projection.includes('name, phone, email') && call.filters.filter(([kind]) => kind === 'or').every(([, expression]) => expression === 'registration_no.ilike.%REG%')));
});

for (const table of ['events', 'event_sessions', 'event_ticket_types', 'registration_forms', 'registration_form_fields', 'membership_plans']) {
  test(`events page fails closed if ${table} second page fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.eventsPage.default({ searchParams: Promise.resolve({}) }), error => error.message.includes('目前無法確認操作結果') && !error.message.includes(privateError));
  });
}

test('registration list and export fail closed on second page', async () => {
  const f = fixture({ failTable: 'registrations' });
  await assert.rejects(() => f.registrationsPage.default({ searchParams: Promise.resolve(params) }), error => error.message.includes('目前無法確認操作結果') && !error.message.includes(privateError));
  const response = await f.route.GET(request('&format=csv'));
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes(privateError));
});

test('disabled module and denied role stop event reads', async () => {
  const disabled = fixture({ enabled: false });
  assert.match(renderToStaticMarkup(await disabled.eventsPage.default({ searchParams: Promise.resolve({}) })), /模組未啟用/);
  assert.equal(disabled.calls.length, 0);
  const denied = fixture({ deny: true });
  await assert.rejects(() => denied.eventsPage.default({ searchParams: Promise.resolve({}) }), /DENIED/);
  assert.equal(denied.calls.length, 0);
});
