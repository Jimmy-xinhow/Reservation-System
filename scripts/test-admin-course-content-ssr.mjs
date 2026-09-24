import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'course-brand';
const privateError = 'PRIVATE_COURSE_DB_SECRET';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency: ${name}`);
  }, Intl, Date });
  return exports;
}

const pagination = load('lib/supabase-pagination.ts', {
  'server-only': {},
  '@/lib/admin-query': { adminQuery: async value => await value, adminErrorMessage: () => '目前無法確認操作結果' },
});

function fixture({ failTable = '', deny = false, enabled = true } = {}) {
  const calls = [];
  const events = Array.from({ length: 1001 }, (_, index) => ({ id: `event-${index}`, clinic_id: clinicId, title: `課程 ${index}`, status: 'published', created_at: '2026-09-23' }));
  const units = Array.from({ length: 1001 }, (_, index) => ({ id: `unit-${index}`, clinic_id: clinicId, title: `單元 ${index}`, summary: null, unit_type: 'assignment', access_rule: 'registered', release_mode: 'immediate', release_days: 0, sort_order: index, active: true, created_at: '2026-09-23', events: { title: `課程 ${index}` }, course_assessments: null }));
  const submissions = Array.from({ length: 1001 }, (_, index) => ({ id: `submission-${index}`, clinic_id: clinicId, status: 'submitted', submission_text: `待審核作業 ${index}`, score: null, feedback: null, submitted_at: '2026-09-23', patients: { name: `學員 ${index}` }, course_units: { title: `單元 ${index}`, events: { title: `課程 ${index}` } } }));
  submissions.push({ ...submissions[0], id: 'foreign-submission', clinic_id: 'foreign-brand', submission_text: 'FOREIGN_MARKER' });
  const certificates = Array.from({ length: 31 }, (_, index) => ({ id: `certificate-${index}`, clinic_id: clinicId, certificate_no: `CERT${index}`, issued_at: '2026-09-23', patients: { name: '學員' }, events: { title: '課程' } }));
  const rows = { events, course_units: units, course_assessment_submissions: submissions, course_certificates: certificates };
  const client = { from(table) {
    const call = { table, projection: '', filters: [], orders: [], range: null, limit: null };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && (call.range?.[0] === 1000 || table === 'course_certificates')) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        let data = rows[table] ?? [];
        for (const [kind, column, value] of call.filters) {
          if (kind === 'eq') data = data.filter(row => row[column] === value);
          if (kind === 'in') data = data.filter(row => value.includes(row[column]));
        }
        const [from, to] = call.range ?? [0, (call.limit ?? 1000) - 1];
        return Promise.resolve({ data: data.slice(from, to + 1), error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (key === 'eq' || key === 'in') call.filters.push([key, ...args]);
        if (key === 'order') call.orders.push(args[0]);
        if (key === 'range') call.range = args;
        if (key === 'limit') call.limit = args[0];
        return query;
      };
    } });
    return query;
  } };
  const page = load('app/admin/course-content/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/admin': { requireAdmin: async () => { if (deny) throw Error('DENIED'); return { supabase: client, clinicId }; } },
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => enabled },
    '@/components/ModuleDisabled': { ModuleDisabled: () => jsx.jsx('p', { children: '模組未啟用' }) },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/lib/admin-query': { adminQuery: async value => await value, adminErrorMessage: () => '目前無法確認操作結果' },
    '@/lib/supabase-pagination': pagination,
    './actions': { createCourseUnitAction: () => {}, reviewCourseAssignmentAction: () => {}, toggleCourseUnitAction: () => {} },
  });
  return { page, calls };
}

test('course management renders the 1001st event, unit and pending submission without foreign records', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /課程 1000/);
  assert.match(html, /單元 1000/);
  assert.match(html, /待審核作業 1000/);
  assert.ok(!html.includes('FOREIGN_MARKER'));
  assert.ok(html.includes('CERT29') && !html.includes('CERT30'));
  for (const table of ['events', 'course_units', 'course_assessment_submissions']) {
    const calls = f.calls.filter(call => call.table === table);
    assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999]]);
    assert.ok(calls.every(call => call.orders.includes('id') && call.filters.some(([kind, key, value]) => kind === 'eq' && key === 'clinic_id' && value === clinicId)));
  }
});

for (const table of ['events', 'course_units', 'course_assessment_submissions', 'course_certificates']) {
  test(`course management fails closed when ${table} query fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.page.default(), error => error.message.includes('目前無法確認操作結果') && !error.message.includes(privateError));
  });
}

test('course management does not read data when module is disabled or role is denied', async () => {
  const disabled = fixture({ enabled: false });
  assert.match(renderToStaticMarkup(await disabled.page.default()), /模組未啟用/);
  assert.equal(disabled.calls.length, 0);
  const denied = fixture({ deny: true });
  await assert.rejects(() => denied.page.default(), /DENIED/);
  assert.equal(denied.calls.length, 0);
});
