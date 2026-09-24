import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const secret = 'Authorization=Bearer private-import-error';

function load(file, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    React, Date, Intl, Promise, Array,
  });
  return exports;
}

const adminQuery = load('lib/admin-query.ts', { 'server-only': {}, '@/lib/error-category': { errorCategory: () => 'external' } });
const pagination = load('lib/supabase-pagination.ts', { 'server-only': {}, '@/lib/admin-query': adminQuery });

function fixture({ count = 1001, failure, denied = false } = {}) {
  const calls = [];
  let serviceCalls = 0;
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `job-${String(i).padStart(5, '0')}`, clinic_id: 'fixture-brand', entity: 'patients', status: 'completed',
    total_rows: 2, imported_rows: 2, failed_rows: 0, error_summary: [], created_at: new Date(Date.UTC(2026, 8, 30) - i * 1000).toISOString(),
  }));
  rows.push({ ...rows[0], id: 'foreign-job', clinic_id: 'foreign-brand', entity: 'external-secret' });
  function from(table) {
    assert.equal(table, 'data_import_jobs');
    const call = { clinic: null, range: null, limit: null, columns: null };
    calls.push(call);
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(column, value) { if (column === 'clinic_id') call.clinic = value; return query; },
      order() { return query; },
      range(start, end) { call.range = [start, end]; return query; },
      limit(value) { call.limit = value; return query; },
      then(resolve, reject) {
        if (failure && ((failure.kind === 'summary' && call.range?.[0] === failure.from) || (failure.kind === 'recent' && call.limit === 20))) {
          const response = failure.mode === 'throw' ? Promise.reject(new Error(secret))
            : Promise.resolve({ data: failure.mode === 'null' ? null : [], error: failure.mode === 'error' ? { message: secret } : null });
          return response.then(resolve, reject);
        }
        const scoped = rows.filter(row => row.clinic_id === call.clinic);
        const data = call.range ? scoped.slice(call.range[0], call.range[1] + 1) : scoped.slice(0, call.limit);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const page = load('app/admin/import/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/admin-query': adminQuery,
    '@/lib/admin': { requireAdmin: async () => { if (denied) throw new Error('DENIED'); return { clinicId: 'fixture-brand' }; } },
    '@/lib/supabase': { createServiceClient: () => { serviceCalls++; return { from }; } },
    '@/lib/supabase-pagination': pagination,
    '@/lib/import-error': { safeImportErrors: errors => errors.map(row => ({ ...row, reason: '安全原因' })) },
    './CsvImportWizard': { CsvImportWizard: () => React.createElement('div', null, 'wizard') },
  });
  return { render: async () => renderToStaticMarkup(await page.default()), calls, serviceCalls: () => serviceCalls };
}

test('import metrics include job 1001 while history stays at 20 and all queries are tenant scoped', async () => {
  const h = fixture();
  const html = await h.render();
  assert.match(html, /完成工作<\/span><strong class="admin-metric-value">1001<\/strong>/);
  assert.match(html, /成功資料列<\/span><strong class="admin-metric-value">2002<\/strong>/);
  assert.match(html, /顯示最近 20 次工作/);
  assert.match(html, /20 筆/);
  assert(!html.includes('external-secret'));
  assert(h.calls.some(call => call.range?.[0] === 1000));
  assert(h.calls.every(call => call.clinic === 'fixture-brand'));
  assert(h.calls.filter(call => call.range).every(call => call.columns === 'status, imported_rows'));
});

for (const mode of ['error', 'throw', 'null']) {
  test(`summary second page ${mode} fails closed`, async () => {
    const h = fixture({ failure: { kind: 'summary', from: 1000, mode } });
    await assert.rejects(h.render(), error => !error.message.includes(secret));
  });
}

test('recent history null result cannot become empty success', async () => {
  const h = fixture({ failure: { kind: 'recent', mode: 'null' } });
  await assert.rejects(h.render(), /讀取匯入紀錄不完整/);
});

test('unauthorized session stops before service client and queries', async () => {
  const h = fixture({ denied: true });
  await assert.rejects(h.render(), /DENIED/);
  assert.equal(h.serviceCalls(), 0);
  assert.equal(h.calls.length, 0);
});
