import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const privateError = 'PRIVATE_DASHBOARD_FINANCE_DB_0923';
const safeError = '目前無法確認操作結果';
const financialTables = ['sales_payments', 'sales_orders', 'purchase_orders', 'inventory_items'];
const operationalTables = ['appointments', 'registrations', 'payment_orders', 'crm_delivery_logs', 'handoff_tasks'];

function load(file, deps) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, Intl, Math, Object, Array });
  return exports;
}

function fixture({ failTable, failFrom = 1000, returnedErrorTable, additionalData = {},
  settings = {}, setupData = {}, headCounts = {}, attendanceSettings = { click_enabled: false, qr_enabled: false },
  chatThreads = [], throwChat = false, role = 'staff', financialRows = 1005 } = {}) {
  const calls = [];
  const at = '2026-09-22T12:00:00.000Z';
  const rows = (row) => Array.from({ length: financialRows }, (_, index) => ({ id: `row-${index}`, clinic_id: 'brand-a', ...row }));
  const data = {
    sales_payments: [...rows({ amount: 1, received_at: at }), { clinic_id: 'brand-b', amount: 999999, received_at: at }],
    sales_orders: rows({ total_amount: 2, paid_amount: 1, status: 'open', created_at: at }),
    purchase_orders: rows({ status: 'ordered', created_at: at, purchase_order_items: [{ quantity: 1, unit_cost: 1 }] }),
    inventory_items: rows({ stock_on_hand: 1, reorder_level: 0, retail_price: 2, active: true }),
    ...additionalData,
  };
  const db = { from(table) {
    const call = { table, filters: [], orders: [], range: null, head: false, projection: null };
    calls.push(call);
    let query;
    query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && call.range?.[0] === failFrom) {
          return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        }
        if (table === returnedErrorTable) return Promise.resolve({ data: null, error: { message: privateError, code: '42P01' } }).then(resolve, reject);
        if (table === 'clinic_settings') return Promise.resolve({ data: {
          public_booking_enabled: true, public_registration_enabled: false, events_enabled: false,
          memberships_enabled: false, crm_automation_enabled: false, line_channel_enabled: false,
          email_enabled: false, deposit_enabled: false, brand_page_enabled: false, dashboard_focus: 'mixed',
          ...settings,
        }, error: null }).then(resolve, reject);
        if (table === 'attendance_settings') return Promise.resolve({ data: attendanceSettings, error: null }).then(resolve, reject);
        if (call.head) return Promise.resolve({ data: null, count: headCounts[table] ?? 0, error: null }).then(resolve, reject);
        if (table in setupData && !Array.isArray(setupData[table])) {
          return Promise.resolve({ data: setupData[table], error: null }).then(resolve, reject);
        }
        let result = data[table] ?? [];
        if (table in setupData) result = setupData[table];
        const field = (row, column) => column.split('.').reduce((value, part) => value?.[part], row);
        for (const [method, column, value] of call.filters) {
          if (method === 'eq') result = result.filter(row => field(row, column) === value);
          if (method === 'neq') result = result.filter(row => field(row, column) !== value);
          if (method === 'gte') result = result.filter(row => field(row, column) >= value);
          if (method === 'lte') result = result.filter(row => field(row, column) <= value);
          if (method === 'in') result = result.filter(row => value.includes(field(row, column)));
          if (method === 'is') result = result.filter(row => (field(row, column) ?? null) === value);
        }
        result = result.slice(call.range?.[0] ?? 0, (call.range?.[1] ?? 999) + 1);
        return Promise.resolve({ data: result, count: result.length, error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') { call.projection = args[0]; call.head = args[1]?.head === true; }
        else if (key === 'order') call.orders.push(args);
        else if (key === 'range') call.range = args;
        else if (['eq', 'neq', 'gte', 'lte', 'in', 'is'].includes(key)) call.filters.push([key, ...args]);
        return query;
      };
    } });
    return query;
  } };
  const adminQuery = async value => { try { return await value; } catch { throw Error(safeError); } };
  const fetchAllSupabasePages = load('lib/supabase-pagination.ts', {
    'server-only': {}, '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
  }).fetchAllSupabasePages;
  const pass = ({ children }) => children ?? null;
  const page = load('app/admin/dashboard/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
    '@/lib/supabase-pagination': { fetchAllSupabasePages },
    'next/link': { default: ({ children, href }) => jsx.jsx('a', { href, children }) },
    '@/lib/admin': { requireMember: async () => ({ clinicId: 'brand-a', role, user: { id: 'actor' }, supabase: db }),
      hasBrandPermission: () => false, getAssignedDoctorIds: async () => ['doctor-a'] },
    '@/lib/slots': { taipeiDateString: value => String(value).slice(0, 10) },
    '@/components/AutoRefresh': { AutoRefresh: pass },
    '@/components/AdminProductTelemetry': { PermissionHelpButton: pass },
    '@/components/admin/OperationsCharts': { ScheduleTimeline: pass, TrendLineChart: pass },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/lib/chatQueries': { buildThreads: async () => { if (throwChat) throw Error(privateError); return chatThreads; } },
    '../handoff/attendance-actions': { recordButtonAttendanceAction: async () => {} },
    '@/components/LiveTaipeiClock': { LiveTaipeiClock: pass },
  }).default;
  return { page, calls };
}

test('dashboard financial metrics include every scoped page, matching the finance drill-down', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({}) }));
  for (const value of ['NT$1,005', 'NT$2,010']) assert.ok(html.includes(value), value);
  assert.ok(!html.includes('999,999'));
  for (const table of financialTables) {
    const calls = f.calls.filter(call => call.table === table);
    assert.equal(calls.length, 2, table);
    assert.deepEqual(calls.map(call => call.range.join(',')), ['0,999', '1000,1999']);
    assert.ok(calls.every(call => call.filters.some(([method, column, value]) =>
      method === 'eq' && column === 'clinic_id' && value === 'brand-a')));
    assert.ok(calls.every(call => call.orders.some(([column]) => column === 'id')));
  }
});

test('new brand sees setup and quick actions before metrics; configured brand keeps setup below daily work', async () => {
  const newBrand = fixture({ role: 'owner', financialRows: 0 });
  const newHtml = renderToStaticMarkup(await newBrand.page({ searchParams: Promise.resolve({}) }));
  assert.ok(newHtml.indexOf('新品牌上線準備') < newHtml.indexOf('常用操作'));
  assert.ok(newHtml.indexOf('常用操作') < newHtml.indexOf('admin-metric-strip'));
  assert.ok(newHtml.includes('/admin/checkout?modal=new-sale'));

  const configuredBrand = fixture({
    role: 'owner', financialRows: 0,
    setupData: { clinics: { name: '測試品牌', slug: 'test-brand' } },
    headCounts: { services: 1, doctors: 1, schedule_templates: 1 },
  });
  const configuredHtml = renderToStaticMarkup(await configuredBrand.page({ searchParams: Promise.resolve({}) }));
  assert.ok(configuredHtml.indexOf('常用操作') < configuredHtml.indexOf('admin-metric-strip'));
  assert.ok(configuredHtml.indexOf('admin-metric-strip') < configuredHtml.indexOf('新品牌上線準備'));

  const eventOnlyBrand = fixture({
    role: 'owner', financialRows: 0,
    settings: { events_enabled: true, public_booking_enabled: false, public_registration_enabled: true },
    setupData: { clinics: { name: '活動品牌', slug: 'event-brand' } },
    headCounts: { events: 1 },
  });
  const eventHtml = renderToStaticMarkup(await eventOnlyBrand.page({ searchParams: Promise.resolve({}) }));
  assert.ok(eventHtml.includes('目前只開放活動報名，無需設定服務排班'));
  assert.ok(eventHtml.indexOf('admin-metric-strip') < eventHtml.indexOf('新品牌上線準備'));
});

test('dashboard second financial page failure does not display partial metrics', async () => {
  const f = fixture({ failTable: 'inventory_items' });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
    error => error.message === safeError && !error.message.includes(privateError));
});

function operationalFixture(options = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  const at = new Date(`${today}T12:00:00+08:00`).toISOString();
  const make = (table, row) => Array.from({ length: 1001 }, (_, index) => ({
    id: `${table}-${index}`, clinic_id: 'brand-a', ...row,
  }));
  const additionalData = {
    appointments: make('appointment', { start_at: at, end_at: at, status: 'booked', doctor_id: 'doctor-a',
      doctors: { name: '驗收服務人員' }, services: { name: '驗收服務' } }),
    registrations: make('registration', { created_at: at, status: 'pending', payment_status: 'pending', amount: 1 }),
    payment_orders: make('payment', { created_at: at, status: 'pending', amount: 1 }),
    crm_delivery_logs: make('delivery', { created_at: at, status: 'failed' }),
    handoff_tasks: make('handoff', { priority: 'high', status: 'open' }),
  };
  for (const table of operationalTables) additionalData[table].push({
    ...additionalData[table][0], id: `foreign-${table}`, clinic_id: 'brand-b',
  });
  return fixture({ financialRows: 0, settings: { events_enabled: true, crm_automation_enabled: true },
    additionalData, ...options });
}

test('dashboard operational counts include page 1001 for all five tenant sources', async () => {
  const f = operationalFixture();
  const html = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({}) }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const expected of ['今日服務預約 1001', '今日課程／活動報名 1001',
    '待確認預約 1001', '待付款報名 2002', 'CRM 發送失敗 查看近 14 日 CRM 投遞 1001', '交班 1001 項']) {
    assert.ok(text.includes(expected), expected);
  }
  for (const value of ['今日服務預約', '待確認預約', '待付款報名', 'CRM 發送失敗', '交班 1001 項', '1001 項高優先交班']) {
    assert.ok(html.includes(value), value);
  }
  assert.ok(html.includes('2002'));
  assert.ok(!html.includes('1002 項高優先交班'));
  for (const table of operationalTables) {
    const calls = f.calls.filter(call => call.table === table);
    assert.equal(calls.length, 2, table);
    assert.deepEqual(calls.map(call => call.range.join(',')), ['0,999', '1000,1999']);
    assert.ok(calls.every(call => call.filters.some(([method, column, value]) =>
      method === 'eq' && column === 'clinic_id' && value === 'brand-a')));
    assert.ok(calls.every(call => call.orders.some(([column]) => column === 'id')));
  }
});

for (const table of operationalTables) test(`dashboard ${table} second-page error fails closed`, async () => {
  const f = operationalFixture({ failTable: table });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
    error => error.message === safeError && !error.message.includes(privateError));
});

test('dashboard missing attendance table fails instead of showing fabricated empty state', async () => {
  const f = fixture({ financialRows: 0, returnedErrorTable: 'attendance_settings' });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
    error => error.message === safeError && !error.message.includes(privateError));
});

test('provider dashboard keeps assigned-doctor filter while paging appointments', async () => {
  const f = operationalFixture({ role: 'provider' });
  const html = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({}) }));
  assert.ok(html.includes('我的今日工作台'));
  const calls = f.calls.filter(call => call.table === 'appointments');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.filters.some(([method, column, values]) =>
    method === 'in' && column === 'doctor_id' && values.includes('doctor-a'))));
  assert.equal(f.calls.filter(call => ['registrations', 'payment_orders', 'crm_delivery_logs', 'handoff_tasks'].includes(call.table)).length, 0);
  assert.equal(f.calls.filter(call => ['clinics', 'services', 'events', 'doctors', 'service_resources',
    'schedule_templates', 'clinic_line_channels', 'line_richmenu', 'clinic_payment_settings'].includes(call.table)).length, 0);
});

test('owner setup, attendance and chat projections keep tenant and user scope', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  const at = new Date(`${today}T10:00:00+08:00`).toISOString();
  const f = fixture({ role: 'owner', financialRows: 0,
    settings: { events_enabled: true, public_registration_enabled: true, line_channel_enabled: true,
      email_enabled: true, deposit_enabled: true, brand_page_enabled: true },
    setupData: {
      clinics: { name: '驗收品牌', slug: 'qa-brand' },
      schedule_templates: [{ id: 'resource-schedule', clinic_id: 'brand-a', doctor_id: null, active: true,
        services: { active: true, booking_target: 'resource_only' } }],
      clinic_line_channels: { verification_status: 'ready', liff_id: 'liff-test' },
      line_richmenu: { published_version_id: 'rich-menu-test' },
      clinic_payment_settings: { active: true },
    },
    headCounts: { services: 1, doctors: 0, service_resources: 0, schedule_templates: 1, patients: 5 },
    attendanceSettings: { click_enabled: true, qr_enabled: true },
    additionalData: { attendance_events: [
      { clinic_id: 'brand-a', user_id: 'actor', event_type: 'clock_in', occurred_at: at },
      { clinic_id: 'brand-b', user_id: 'actor', event_type: 'clock_out', occurred_at: at },
    ] },
    chatThreads: [
      { lineUserId: 'line-1', name: '本品牌顧客一', lastBody: '訊息一', unread: 2 },
      { lineUserId: 'line-2', name: '本品牌顧客二', lastBody: '訊息二', unread: 1 },
      { lineUserId: 'line-3', name: '本品牌顧客三', lastBody: '訊息三', unread: 0 },
      { lineUserId: 'line-4', name: '本品牌顧客四', lastBody: '訊息四', unread: 2 },
    ] });
  const html = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({}) }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('最近：上班'));
  assert.ok(!text.includes('最近：下班'));
  assert.ok(html.includes('本品牌顧客一'));
  assert.ok(!html.includes('本品牌顧客四'));
  assert.ok(text.includes('全部未讀訊息： 5'));
  assert.ok(html.includes('可管理顧客'));
  assert.ok(text.includes('5 人'));
  assert.ok(html.includes('免指定人員服務排班') || html.includes('可提供服務的排班已建立'));
  assert.ok(html.includes('測試環境已就緒'));
  assert.ok(html.includes('品牌形象頁 ↗'));
  const clinic = f.calls.find(call => call.table === 'clinics');
  assert.ok(clinic.filters.some(([method, column, value]) => method === 'eq' && column === 'id' && value === 'brand-a'));
  const resourceSchedule = f.calls.find(call => call.table === 'schedule_templates' && !call.head);
  assert.ok(resourceSchedule.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === 'brand-a'));
  assert.ok(resourceSchedule.filters.some(([method, column, value]) => method === 'is' && column === 'doctor_id' && value === null));
  assert.ok(resourceSchedule.filters.some(([method, column, values]) => method === 'in' && column === 'services.booking_target' && values.includes('resource_only')));
  const attendance = f.calls.find(call => call.table === 'attendance_events');
  assert.ok(attendance.filters.some(([method, column, value]) => method === 'eq' && column === 'user_id' && value === 'actor'));
  assert.ok(attendance.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === 'brand-a'));
});

for (const table of ['clinics', 'services', 'events', 'doctors', 'service_resources',
  'schedule_templates', 'clinic_line_channels', 'line_richmenu', 'clinic_payment_settings']) {
  test(`owner dashboard ${table} setup failure fails closed`, async () => {
    const f = fixture({ role: 'owner', financialRows: 0, returnedErrorTable: table });
    await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
      error => error.message === safeError && !error.message.includes(privateError));
  });
}

for (const table of ['patients', 'attendance_events']) {
  test(`dashboard ${table} summary failure fails closed`, async () => {
    const f = fixture({ financialRows: 0, returnedErrorTable: table });
    await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
      error => error.message === safeError && !error.message.includes(privateError));
  });
}

test('dashboard chat query failure does not appear as no conversations', async () => {
  const f = fixture({ financialRows: 0, settings: { line_channel_enabled: true }, throwChat: true });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
    error => error.message === safeError && !error.message.includes(privateError));
});
