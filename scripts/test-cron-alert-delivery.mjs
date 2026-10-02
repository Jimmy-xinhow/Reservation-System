import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const jobs = ['reminders', 'marketing', 'membership', 'followups', 'registration', 'richmenu', 'subscription-freezes'];
const secret = 'synthetic-cron-secret';
const clinicId = '11111111-1111-4111-8111-111111111111';
const alert = {
  id: '22222222-2222-4222-8222-222222222222',
  incident_id: '33333333-3333-4333-8333-333333333333',
  mode: 'scoped', job: 'reminders', transition: 'incident',
  observed_state: 'missing', attempts: 1,
};
const source = readFileSync('app/api/cron/health/alerts/route.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

function fixture({ queued = [], emailError = null, healthState = 'healthy', configured = true } = {}) {
  const rpcCalls = [], messages = [];
  let emailReads = 0;
  const queue = [...queued];
  const service = { async rpc(name, args) {
    rpcCalls.push([name, args]);
    if (name === 'claim_cron_alert_delivery') return { data: queue.length ? [queue.shift()] : [], error: null };
    if (name === 'finish_cron_alert_delivery') return { data: true, error: null };
    return { data: null, error: null };
  } };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Response, Headers, AbortSignal, Object, Array, RegExp, Error,
    process: { env: {
      CRON_SECRET: secret,
      CRON_ALERT_ENABLED: configured ? '1' : undefined,
      CRON_ALERT_CLINIC_ID: clinicId,
      CRON_ALERT_TO_EMAIL: 'ops@example.test',
    } },
    require(name) {
      if (name === '../route') return { GET: async () => Response.json({
        ok: healthState === 'healthy',
        jobs: jobs.map((job, index) => ({ job, state: index === 0 ? healthState : 'healthy' })),
      }, { status: healthState === 'healthy' ? 200 : 503 }) };
      if (name === '@/lib/email') return {
        emailConfigForClinic: async (id) => { assert.equal(id, clinicId); emailReads++; return { apiKey: 'private', from: 'ops@example.test' }; },
        isEmailProviderRejected: error => error instanceof Error && error.message === 'delivery_error:provider_rejected',
        sendEmail: async (...args) => { messages.push(args); if (emailError) throw emailError; },
      };
      if (name === '@/lib/supabase') return { createServiceClient: () => service };
      if (name === '@/lib/cron-allowlist') return { cronAllowedClinics: () => new Set([clinicId]) };
      if (name === '@/lib/http') return { fail: (message, status) => Response.json({ ok: false, error: message }, { status }) };
      if (name === '@/lib/cron-operations-health') return {
        CRON_JOB_EXPECTATIONS: jobs.map(job => ({ job, label: job })),
      };
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  return { POST: exports.POST, rpcCalls, messages, emailReads: () => emailReads };
}

const request = (token = secret) => ({ headers: new Headers({ authorization: `Bearer ${token}` }) });

test('alert endpoint rejects unauthenticated callers before reading state or credentials', async () => {
  const f = fixture({ queued: [alert] });
  assert.equal((await f.POST(request('wrong'))).status, 401);
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.emailReads(), 0);
  assert.equal(f.messages.length, 0);
});

test('disabled channel fails closed before changing alert state', async () => {
  const f = fixture({ configured: false });
  assert.equal((await f.POST(request())).status, 503);
  assert.equal(f.rpcCalls.length, 0);
});

test('one claimed incident uses a stable provider idempotency key and records acknowledgement', async () => {
  const f = fixture({ queued: [alert], healthState: 'missing' });
  const response = await f.POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).delivered, 1);
  assert.equal(f.rpcCalls.filter(([name]) => name === 'record_cron_alert_observation').length, 7);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0][4].idempotencyKey, `cron-alert-${alert.id}`);
  assert.equal(f.rpcCalls.find(([name]) => name === 'finish_cron_alert_delivery')[1].p_sent, true);
  assert(!f.messages[0][2].includes(secret));
  assert(!f.messages[0][3].includes('private'));
});

test('definite provider rejection is recorded while rate-limit and network uncertainty keep the lease', async () => {
  const known = fixture({ queued: [alert], emailError: new Error('delivery_error:provider_rejected') });
  assert.equal((await known.POST(request())).status, 503);
  assert.equal(known.rpcCalls.find(([name]) => name === 'finish_cron_alert_delivery')[1].p_error_code, 'provider_rejected');

  const rateLimited = fixture({ queued: [alert], emailError: new Error('Email 寄送失敗 (429)') });
  assert.equal((await rateLimited.POST(request())).status, 503);
  assert.equal(rateLimited.rpcCalls.some(([name]) => name === 'finish_cron_alert_delivery'), false);

  const uncertain = fixture({ queued: [alert], emailError: new Error('外部服務連線失敗 (fetch failed)') });
  assert.equal((await uncertain.POST(request())).status, 503);
  assert.equal(uncertain.rpcCalls.some(([name]) => name === 'finish_cron_alert_delivery'), false);
});
