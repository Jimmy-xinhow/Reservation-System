import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const source = fs.readFileSync('app/admin/platform/operations/page.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const cronExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/cron-operations-health.ts', 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, { exports: cronExports, Object, Number, Date });

function fixture({ counts = {}, cronRows = {}, errorTable, deny = false } = {}) {
  const calls = [];
  let serviceClients = 0;
  const service = { from(table) {
    const call = { table, filters: [] };
    calls.push(call);
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve().then(() => {
        if (table === 'cron_job_runs') {
          const job = call.filters.find(([method, column]) => method === 'eq' && column === 'job')?.[2];
          return { data: cronRows[job] ? [cronRows[job]] : [], error: table === errorTable ? { message: 'PRIVATE_PROVIDER_CANARY' } : null };
        }
        const pending = call.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'pending');
        const lookup = `${table}${pending ? ':pending' : ''}`;
        return { count: counts[lookup] ?? 0, error: table === errorTable ? { message: 'PRIVATE_PROVIDER_CANARY' } : null };
      }).then(resolve, reject);
      return (...args) => {
        if (key === 'select') call.select = args;
        else call.filters.push([key, ...args]);
        return query;
      };
    } });
    return query;
  } };
  const deps = {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ href, children }) => jsx.jsx('a', { href, children }) },
    '@/lib/admin-query': { adminQuery: async p => await p, adminErrorMessage: () => '目前無法確認操作結果' },
    '@/lib/platform': { requireSystemPermission: async () => { if (deny) throw Error('DENIED'); } },
    '@/lib/cron-operations-health': cronExports,
    '@/lib/supabase': { createServiceClient: () => { serviceClients++; return service; } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, process: { env: { CRON_SECRET: 'configured-test-value' } } });
  return { page: exports.default, calls, serviceClients: () => serviceClients };
}

test('zero delivery backlog does not show green cron health from a configured key', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page());
  assert.match(html, /7 類排程待查/);
  assert.match(html, /尚無紀錄/);
  assert.match(html, /隔離測試的指定範圍執行不列入正式排程健康/);
  assert.match(html, /不代表排程正在執行/);
  assert.doesNotMatch(html, /目前無通知失敗/);
  assert.equal(f.calls.filter(call => call.table === 'scheduled_followups').length, 2);
  assert.equal(f.calls.filter(call => call.table === 'cron_job_runs').length, 7);
  assert(f.calls.filter(call => call.table === 'cron_job_runs').every(call => call.filters.some(([method, column, value]) => method === 'eq' && column === 'mode' && value === 'global')));
  for (const call of f.calls.filter(call => !['clinic_line_secret_refs', 'clinic_email_secret_refs', 'clinic_payment_secret_refs', 'cron_job_runs'].includes(call.table))) {
    assert.equal(call.select[0], 'id');
    assert.equal(call.select[1].count, 'exact');
    assert.equal(call.select[1].head, true);
  }
});

test('recent global runs turn healthy while one stale run remains visible', async () => {
  const recent = new Date().toISOString();
  const cronRows = Object.fromEntries(cronExports.CRON_JOB_EXPECTATIONS.map(({ job }) =>
    [job, { status: 'success', result_code: 'success', http_status: 200, completed_at: recent }]));
  const healthy = renderToStaticMarkup(await fixture({ cronRows }).page());
  assert.match(healthy, /排程與通知正常/);
  cronRows.followups = { ...cronRows.followups, completed_at: new Date(Date.now() - 120 * 60000).toISOString() };
  const stale = renderToStaticMarkup(await fixture({ cronRows }).page());
  assert.match(stale, /1 類排程待查/);
  assert.match(stale, /逾時未執行/);
  assert.doesNotMatch(stale, /排程與通知正常/);
});

test('failed global run shows safe reason and does not count as healthy', async () => {
  const cronRows = Object.fromEntries(cronExports.CRON_JOB_EXPECTATIONS.map(({ job }) =>
    [job, { status: 'success', result_code: 'success', http_status: 200, completed_at: new Date().toISOString() }]));
  cronRows.reminders = { ...cronRows.reminders, status: 'failed', result_code: 'partial_failure' };
  const html = renderToStaticMarkup(await fixture({ cronRows }).page());
  assert.match(html, /1 類排程待查/);
  assert.match(html, /部分工作失敗/);
});

test('incomplete sends and overdue followups surface as attention without returning identities', async () => {
  const f = fixture({ counts: { appointment_notification_logs: 2, 'scheduled_followups:pending': 1 } });
  const html = renderToStaticMarkup(await f.page());
  assert.match(html, /3 筆逾期待查/);
  assert.match(html, /結果不明時不要直接重送/);
  const appointment = f.calls.find(call => call.table === 'appointment_notification_logs');
  assert.ok(appointment.filters.some(([method, column, values]) => method === 'in' && column === 'status' && values.includes('sending')));
  const pending = f.calls.find(call => call.table === 'scheduled_followups' && call.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'pending'));
  assert.ok(pending.filters.some(([method, column, values]) => method === 'in' && column === 'channel' && values.includes('line') && values.includes('email')));
});

test('query failure fails closed and never reveals provider text', async () => {
  const f = fixture({ errorTable: 'reminder_logs' });
  await assert.rejects(() => f.page(), error => error.message === '目前無法確認操作結果');
});

test('system permission is checked before service-role client creation', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page(), /DENIED/);
  assert.equal(f.serviceClients(), 0);
  assert.equal(f.calls.length, 0);
});
