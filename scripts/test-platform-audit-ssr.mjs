import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = ts.transpileModule(fs.readFileSync('app/admin/platform/audit/page.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const privateNote = 'PRIVATE_AUDIT_NOTE_0912345678';

function event(table, index, createdAt) {
  const foreignKey = table === 'appointment_status_events' ? 'appointment_id'
    : table === 'registration_status_events' ? 'registration_id' : 'payment_order_id';
  return { id: `${table}-${index}`, clinic_id: 'brand-a', created_at: createdAt,
    from_status: 'pending', to_status: 'confirmed', source: 'admin', actor_id: 'actor-a',
    note: privateNote, [foreignKey]: `record-${index}` };
}
function fixture({ data = {}, failedTable, deny = false } = {}) {
  const queries = [];
  let serviceClients = 0;
  const service = { from(table) {
    const call = { table, select: null, limit: null, order: null };
    queries.push(call);
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve({
        data: data[table] ?? [], error: table === failedTable ? { message: privateNote } : null,
      }).then(resolve, reject);
      return (...args) => { if (key === 'select') call.select = args[0];
        if (key === 'limit') call.limit = args[0];
        if (key === 'order') call.order = args;
        return query; };
    } });
    return query;
  } };
  const deps = {
    'react/jsx-runtime': jsx,
    '@/lib/admin-query': { adminQuery: async p => await p, adminErrorMessage: () => '目前無法確認操作結果' },
    '@/components/TechnicalDetails': { TechnicalDetails: () => null },
    '@/lib/admin-display': { auditSourceLabel: value => value, auditStatusLabel: value => value ?? 'none' },
    '@/lib/platform': { requireSystemPermission: async () => { if (deny) throw Error('DENIED'); } },
    '@/lib/supabase': { createServiceClient: () => { serviceClients++; return service; } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, Map });
  return { page: exports.default, queries, serviceClients: () => serviceClients };
}

test('audit merges the newest 200 across all three event kinds without dropping a busy kind at 100', async () => {
  const appointments = Array.from({ length: 150 }, (_, i) => event('appointment_status_events', i,
    new Date(Date.parse('2026-09-23T00:00:00Z') - i * 1000).toISOString()));
  const payments = Array.from({ length: 80 }, (_, i) => event('payment_status_events', i,
    new Date(Date.parse('2026-09-22T00:00:00Z') - i * 1000).toISOString()));
  const f = fixture({ data: { clinics: [{ id: 'brand-a', name: '測試品牌' }],
    appointment_status_events: appointments, payment_status_events: payments } });
  const html = renderToStaticMarkup(await f.page());
  assert.equal((html.match(/<tr\b/g) ?? []).length, 201);
  assert.match(html, /測試品牌/);
  assert.match(html, /最近 200 筆狀態異動/);
  assert.equal(f.queries.length, 4);
  for (const query of f.queries.filter(q => q.table.endsWith('_status_events'))) {
    assert.equal(query.limit, 200);
    assert.equal(query.order[0], 'created_at');
    assert.equal(query.order[1].ascending, false);
    assert.ok(!query.select.includes('note'));
  }
  assert.ok(!html.includes(privateNote));
});

test('system audit query failure is safe and does not render partial data', async () => {
  const f = fixture({ failedTable: 'registration_status_events' });
  await assert.rejects(() => f.page(), error => error.message === '目前無法確認操作結果');
});

test('audit permission is checked before service-role client creation', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page(), /DENIED/);
  assert.equal(f.serviceClients(), 0);
  assert.equal(f.queries.length, 0);
});
