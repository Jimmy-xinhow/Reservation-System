import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = ts.transpileModule(fs.readFileSync('app/admin/exceptions/page.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const privateError = 'PRIVATE_QUERY_ERROR_0923';

function fixture({ data = {}, failedTable, rejectTable, deny = false } = {}) {
  const queries = [];
  const supabase = { from(table) {
    const call = { table, select: null, clinicId: null };
    queries.push(call);
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === rejectTable) return Promise.reject(Error(privateError)).then(resolve, reject);
        return Promise.resolve({ data: data[table] ?? [],
          error: table === failedTable ? { message: privateError } : null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.select = args[0];
        if (key === 'eq' && args[0] === 'clinic_id') call.clinicId = args[1];
        return query;
      };
    } });
    return query;
  } };
  const deps = {
    'react/jsx-runtime': jsx,
    '@/lib/admin-query': { adminQuery: async value => {
      try { return await value; } catch { throw Error('目前無法確認操作結果'); }
    }, adminErrorMessage: () => '目前無法確認操作結果' },
    '@/lib/admin': { requireAdmin: async () => {
      if (deny) throw Error('DENIED');
      return { clinicId: 'brand-a', supabase };
    } },
    '../schedule-actions': { createExceptionAction: () => {}, deleteExceptionAction: () => {} },
    '../_components/ExceptionForm': { default: () => null },
    '@/components/ConfirmSubmitButton': { ConfirmSubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    '@/components/admin/ManagementTabs': { ServiceSetupTabs: () => null },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, Intl });
  return { page: exports.default, queries };
}

test('exceptions page scopes and projects four sources before rendering real data', async () => {
  const f = fixture({ data: {
    doctors: [{ id: 'provider-a', name: '測試服務員' }],
    services: [{ id: 'service-a', name: '測試服務' }],
    schedule_templates: [],
    schedule_exceptions: [{ id: 'exception-a', doctor_id: 'provider-a', service_id: 'service-a',
      date: '2099-01-01', is_closed: true, start_time: null, end_time: null, capacity: null }],
  } });
  const html = renderToStaticMarkup(await f.page());
  assert.match(html, /休假與臨時加開/);
  assert.match(html, /測試服務員 · 測試服務/);
  assert.match(html, /2099-01-01/);
  assert.ok(!html.includes('尚未設定休假或臨時加開'));
  assert.deepEqual(f.queries.map(query => query.table).sort(),
    ['doctors', 'services', 'schedule_templates', 'schedule_exceptions'].sort());
  for (const query of f.queries) {
    assert.equal(query.clinicId, 'brand-a');
    assert.ok(!query.select.includes('phone'));
  }
});

for (const table of ['doctors', 'services', 'schedule_templates', 'schedule_exceptions']) {
  test(`${table} returned error fails closed instead of showing empty setup`, async () => {
    const f = fixture({ failedTable: table });
    await assert.rejects(() => f.page(), error => error.message === '目前無法確認操作結果');
  });
}

test('exceptions page sanitizes a rejected query', async () => {
  const f = fixture({ rejectTable: 'schedule_exceptions' });
  await assert.rejects(() => f.page(), error => error.message === '目前無法確認操作結果');
});

test('brand permission is checked before any query', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page(), /DENIED/);
  assert.equal(f.queries.length, 0);
});
