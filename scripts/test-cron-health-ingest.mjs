import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('app/api/cron/health/route.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const runId = '11111111-1111-4111-8111-111111111111';
const valid = { run_id: runId, job: 'reminders', mode: 'scoped', status: 'success', result_code: 'success', http_status: 200 };
const healthExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/cron-operations-health.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: healthExports, Date, Number, Object });

function fixture({ insertFailure = null, healthRows = {}, readFailure = false } = {}) {
  const rows = new Map();
  const calls = [];
  const service = { from(table) {
    assert.equal(table, 'cron_job_runs');
    return {
      insert: async record => {
        calls.push(['insert', record]);
        if (insertFailure) return { error: { code: 'XX000', message: 'PRIVATE_PROVIDER_CANARY' } };
        const key = `${record.run_id}/${record.job}`;
        if (rows.has(key)) return { error: { code: '23505' } };
        rows.set(key, record);
        return { error: null };
      },
      select: projection => {
        calls.push(['select', projection]);
        const filters = new Map();
        const query = {
          eq(key, value) { filters.set(key, value); return query; },
          order() { return query; },
          async limit() {
            if (readFailure) return { data: null, error: { code: 'XX000', message: 'PRIVATE_PROVIDER_CANARY' } };
            assert.equal(filters.get('mode'), 'global');
            return { data: healthRows[filters.get('job')] ? [healthRows[filters.get('job')]] : [], error: null };
          },
          async maybeSingle() {
            return { data: rows.get(`${filters.get('run_id')}/${filters.get('job')}`) ?? null, error: null };
          },
        };
        return query;
      },
    };
  } };
  const exports = {};
  let clients = 0;
  vm.runInNewContext(compiled, {
    exports, Response, Headers, Set, Object, Number, Error,
    process: { env: { CRON_SECRET: 'test-secret' } },
    require(name) {
      if (name === '@/lib/http') return { fail: (message, status) => Response.json({ ok: false, error: status >= 500 ? '暫時無法完成' : message }, { status }) };
      if (name === '@/lib/cron-operations-health') return healthExports;
      if (name === '@/lib/supabase') return { createServiceClient: () => { clients++; return service; } };
      throw Error(`Unexpected dependency ${name}`);
    },
  });
  return { GET: exports.GET, POST: exports.POST, rows, calls, clients: () => clients };
}

function request(body, token = 'test-secret') {
  return { headers: new Headers({ authorization: `Bearer ${token}` }), json: async () => body };
}

test('wrong secret rejects before reading the body or service client', async () => {
  const f = fixture();
  const res = await f.POST({ headers: new Headers({ authorization: 'Bearer wrong' }), json: () => { throw Error('body read'); } });
  assert.equal(res.status, 401);
  assert.equal(f.clients(), 0);
});

for (const invalid of [
  null, {}, { ...valid, patient_id: runId }, { ...valid, job: 'global' },
  { ...valid, status: 'failed' }, { ...valid, result_code: 'http_failed' },
  { ...valid, http_status: 201 }, { ...valid, http_status: '200' },
  { ...valid, run_id: 'bad' },
]) test(`invalid heartbeat fails before DB: ${JSON.stringify(invalid)}`, async () => {
  const f = fixture();
  assert.equal((await f.POST(request(invalid))).status, 400);
  assert.equal(f.clients(), 0);
});

test('same run/job is immutable and exact retry is idempotent', async () => {
  const f = fixture();
  const first = await f.POST(request(valid));
  assert.deepEqual(await first.json(), { ok: true, duplicate: false });
  assert.deepEqual(Object.keys(f.rows.get(`${runId}/reminders`)).sort(), Object.keys(valid).sort());
  const retry = await f.POST(request(valid));
  assert.deepEqual(await retry.json(), { ok: true, duplicate: true });
  const conflict = await f.POST(request({ ...valid, mode: 'global' }));
  assert.equal(conflict.status, 409);
  assert.equal(f.rows.size, 1);
});

test('database failure is generic and never returns a provider message', async () => {
  const f = fixture({ insertFailure: true });
  const res = await f.POST(request(valid));
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(await res.json()), /PRIVATE_PROVIDER_CANARY/);
});

test('health GET rejects wrong secret before opening a service client', async () => {
  const f = fixture();
  const response = await f.GET({ headers: new Headers({ authorization: 'Bearer wrong' }) });
  assert.equal(response.status, 401);
  assert.equal(f.clients(), 0);
});

test('health GET fails closed when all global jobs are missing', async () => {
  const f = fixture();
  const response = await f.GET(request(null));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.ok, false);
  assert.equal(body.jobs.length, 7);
  assert(body.jobs.every(row => row.state === 'missing'));
});

test('health GET reports healthy only when seven fresh global runs succeeded', async () => {
  const healthRows = Object.fromEntries(healthExports.CRON_JOB_EXPECTATIONS.map(({ job }) => [job, {
    status: 'success', result_code: 'success', http_status: 200, completed_at: new Date().toISOString(),
  }]));
  const f = fixture({ healthRows });
  const response = await f.GET(request(null));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert(body.jobs.every(row => row.state === 'healthy'));
  assert(f.calls.every(call => call[0] === 'select' && call[1] === 'status,result_code,http_status,completed_at'));
});

test('health GET reports failed and stale runs without private data', async () => {
  const healthRows = Object.fromEntries(healthExports.CRON_JOB_EXPECTATIONS.map(({ job }) => [job, {
    status: 'success', result_code: 'success', http_status: 200, completed_at: new Date().toISOString(),
  }]));
  healthRows.reminders = { ...healthRows.reminders, status: 'failed', result_code: 'http_failed' };
  healthRows.marketing = { ...healthRows.marketing, completed_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString() };
  const response = await fixture({ healthRows }).GET(request(null));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.deepEqual(body.jobs.filter(row => row.state !== 'healthy').map(row => [row.job, row.state]), [
    ['reminders', 'failed'], ['marketing', 'stale'],
  ]);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_PROVIDER_CANARY/);
});

test('health GET hides database failures', async () => {
  const response = await fixture({ readFailure: true }).GET(request(null));
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE_PROVIDER_CANARY/);
});
