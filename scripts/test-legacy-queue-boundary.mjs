import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const privateError = 'PRIVATE_DATABASE_CANARY_0912345678';
function load(file, dependencies) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    require: (name) => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    },
    Error, Promise, Date, Intl, console,
  });
  return exports;
}

function fixture({ rows = {}, errors = {}, rejectedTable = null, role = 'staff' } = {}) {
  const queries = [];
  const client = {
    from(table) {
      const call = { table, filters: [], projection: null };
      queries.push(call);
      const query = new Proxy({}, {
        get: (_, key) => key === 'then'
          ? (resolve, reject) => (table === rejectedTable
            ? Promise.reject(new Error(privateError))
            : Promise.resolve({ data: rows[table] ?? null, error: errors[table] ?? null })).then(resolve, reject)
          : (...args) => {
            if (key === 'select') call.projection = args[0];
            else call.filters.push([key, ...args]);
            return query;
          },
      });
      return query;
    },
  };
  const member = { clinicId: 'fixture-brand', role, supabase: client };
  return { client, queries, member };
}

test('legacy queue returns empty only after successful scoped reads', async () => {
  const f = fixture();
  const queue = load('lib/queue.ts', { 'server-only': {} });
  const sessions = await queue.getQueueForDate(f.client, 'fixture-brand', '2026-09-23', 'time');
  assert.equal(sessions.length, 0);
  assert.deepEqual(f.queries.map((q) => q.table), ['schedule_templates', 'schedule_exceptions', 'appointments', 'serving_numbers']);
  for (const q of f.queries) assert.ok(q.filters.some(([key, column, value]) => key === 'eq' && column === 'clinic_id' && value === 'fixture-brand'));
});

for (const table of ['schedule_templates', 'schedule_exceptions', 'appointments', 'serving_numbers']) {
  test(`legacy queue ${table} failure cannot look like no sessions`, async () => {
    const f = fixture({ errors: { [table]: { message: privateError } } });
    const queue = load('lib/queue.ts', { 'server-only': {} });
    await assert.rejects(() => queue.getQueueForDate(f.client, 'fixture-brand', '2026-09-23', 'time'), (error) => {
      assert.match(error.message, /暫時無法確認/);
      assert.ok(!error.message.includes(privateError));
      return true;
    });
  });
}

test('legacy queue rejected read hides database message', async () => {
  const f = fixture({ rejectedTable: 'appointments' });
  const queue = load('lib/queue.ts', { 'server-only': {} });
  await assert.rejects(() => queue.getQueueForDate(f.client, 'fixture-brand', '2026-09-23', 'time'), (error) => {
    assert.match(error.message, /暫時無法確認/);
    assert.ok(!error.message.includes(privateError));
    return true;
  });
});

test('patient progress lookup failure cannot be reported as no appointment', async () => {
  const f = fixture({ errors: { patients: { message: privateError } } });
  const queue = load('lib/queue.ts', { 'server-only': {} });
  await assert.rejects(() => queue.getPatientQueueToday(f.client, 'fixture-brand', 'line-user', 'time'), /暫時無法確認/);
});

test('patient progress rejected query hides database message', async () => {
  const f = fixture({ rejectedTable: 'patients' });
  const queue = load('lib/queue.ts', { 'server-only': {} });
  await assert.rejects(() => queue.getPatientQueueToday(f.client, 'fixture-brand', 'line-user', 'time'), (error) => {
    assert.match(error.message, /暫時無法確認/);
    assert.ok(!error.message.includes(privateError));
    return true;
  });
});

function adminPage(f, queueReads) {
  return load('app/admin/queue/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase-server': { createSupabaseServer: async () => f.client },
    '@/lib/supabase': { createServiceClient: () => f.client },
    '@/lib/admin': { requireMember: async () => f.member, getAssignedDoctorIds: async () => ['doctor-a'] },
    '@/lib/queue': { taipeiToday: () => '2026-09-23', getQueueForDate: async () => { queueReads.count++; return []; } },
    '../appointment-actions': { advanceServingAction() {}, setQueueAutoAction() {}, setStatusAction() {} },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/components/ConfirmSubmitButton': { ConfirmSubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/components/ModuleDisabled': { ModuleDisabled: ({ title }) => jsx.jsx('p', { children: `${title}未啟用` }) },
    '@/lib/admin-query': { adminQuery: async (query) => await query, adminErrorMessage: () => '目前無法確認操作結果' },
  });
}

test('disabled brand cannot view queue or read appointment sessions', async () => {
  const f = fixture({ rows: { clinic_settings: { booking_mode: 'time', legacy_progress_enabled: false }, doctors: [] } });
  const reads = { count: 0 };
  const page = adminPage(f, reads);
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /現場叫號未啟用/);
  assert.equal(reads.count, 0);
  assert.equal(f.queries.find((q) => q.table === 'clinic_settings').projection, 'booking_mode, legacy_progress_enabled');
});

for (const table of ['clinic_settings', 'doctors']) {
  test(`admin queue ${table} failure cannot look like empty queue`, async () => {
    const f = fixture({ rows: { clinic_settings: { legacy_progress_enabled: true }, doctors: [] }, errors: { [table]: { message: privateError } } });
    const reads = { count: 0 };
    const page = adminPage(f, reads);
    await assert.rejects(() => page.default({ searchParams: Promise.resolve({}) }), /目前無法確認/);
    assert.equal(reads.count, 0);
  });
}

test('enabled brand queue renders only after successful reads', async () => {
  const f = fixture({ rows: { clinic_settings: { booking_mode: 'time', legacy_progress_enabled: true }, doctors: [] } });
  const reads = { count: 0 };
  const page = adminPage(f, reads);
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /本日沒有可叫號的預約/);
  assert.equal(reads.count, 1);
});

function publicPage(f, getQueueForDate) {
  return load('app/q/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase': { createServiceClient: () => f.client },
    '@/lib/queue': { taipeiToday: () => '2026-09-23', getQueueForDate },
    'next/headers': { headers: async () => ({ get: () => 'example.test' }) },
    '@/lib/public-brand': { resolvePublicClinicIdFromScope: async () => 'fixture-brand' },
    '@/components/Brand': { Brand: () => jsx.jsx('span', { children: 'Fixture Brand' }) },
    '@/components/AutoRefresh': { AutoRefresh: () => null },
  });
}

test('public legacy board distinguishes disabled from data failure', async () => {
  const disabled = fixture({ rows: { clinic_settings: { booking_mode: 'time', legacy_progress_enabled: false } } });
  const disabledPage = publicPage(disabled, async () => { throw new Error('must not read queue'); });
  assert.match(renderToStaticMarkup(await disabledPage.default({ searchParams: Promise.resolve({}) })), /目前未開放服務進度頁/);
  const broken = fixture({ errors: { clinic_settings: { message: privateError } } });
  const brokenPage = publicPage(broken, async () => []);
  const html = renderToStaticMarkup(await brokenPage.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /暫時無法載入/);
  assert.ok(!html.includes(privateError));
});

test('public legacy board does not call failed queue read an empty day', async () => {
  const f = fixture({ rows: { clinic_settings: { booking_mode: 'time', legacy_progress_enabled: true } } });
  const page = publicPage(f, async () => { throw new Error(privateError); });
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /暫時無法載入/);
  assert.ok(!html.includes('今日尚無服務進度資料'));
  assert.ok(!html.includes(privateError));
});

test('disabled brand direct queue actions do not query or write a doctor', async () => {
  const f = fixture();
  const actions = load('app/admin/appointment-actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/delivery-error': { deliveryError: () => 'temporary' },
    'next/navigation': { redirect() {} },
    '@/lib/admin': { requireOperator: async () => f.member, requireStatusOperator: async () => f.member },
    '@/lib/supabase': { createServiceClient: () => f.client },
    '@/lib/queue': { getQueueForDate: async () => [] },
    '@/lib/legacy-progress': { isLegacyProgressEnabled: async () => false },
    '@/lib/crm-interactions': { recordCrmInteraction: async () => {} },
    '@/lib/appointment-notifications': { notifyAppointmentStatus: async () => {} },
  });
  const form = { get: () => null };
  await assert.rejects(() => actions.advanceServingAction(form), /未啟用現場叫號/);
  await assert.rejects(() => actions.setQueueAutoAction(form), /未啟用現場叫號/);
  assert.equal(f.queries.length, 0);
});
