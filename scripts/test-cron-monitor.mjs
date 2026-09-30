import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

const jobs = [
  'reminders', 'marketing', 'membership', 'followups', 'registration',
  'richmenu', 'subscription-freezes',
];
const secret = 'synthetic-monitor-secret';
const privateText = 'PRIVATE_PROVIDER_CANARY';
const response = (state = 'healthy') => ({
  ok: state === 'healthy',
  jobs: jobs.map((job, index) => ({ job, state: index === 0 ? state : 'healthy' })),
});

async function exercise(status, body, envOverride = {}, alertStatus = 200, emailStatus = 200) {
  const seen = [];
  const emails = [];
  const server = createServer((req, res) => {
    if (req.url === '/emails') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        emails.push({
          method: req.method,
          authorized: req.headers.authorization === 'Bearer synthetic-send-only-key',
          idempotencyKey: req.headers['idempotency-key'],
          payload: JSON.parse(raw),
        });
        res.writeHead(emailStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: privateText }));
      });
      return;
    }
    seen.push({ method: req.method, path: req.url, authorized: req.headers.authorization === `Bearer ${secret}` });
    if (req.url === '/api/cron/health/alerts') {
      res.writeHead(alertStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: alertStatus === 200 }));
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      APP_URL: `http://127.0.0.1:${server.address().port}`,
      CRON_SECRET: secret,
      CRON_ALERT_ENABLED: '',
      INFRA_ALERT_ENABLED: '',
      INFRA_ALERT_TEST_ENDPOINT: `http://127.0.0.1:${server.address().port}/emails`,
      ...envOverride,
    };
    const child = spawn(process.execPath, ['scripts/monitor-cron-health.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    return { code, stdout, stderr, seen, emails, record: JSON.parse(stdout.trim()) };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('monitor accepts exactly seven fresh healthy jobs', async () => {
  const result = await exercise(200, response());
  assert.equal(result.code, 0);
  assert.equal(result.record.status, 'healthy');
  assert.deepEqual(result.seen, [{ method: 'GET', path: '/api/cron/health', authorized: true }]);
});

test('monitor reports missing jobs and exits nonzero', async () => {
  const result = await exercise(503, response('missing'));
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'unhealthy');
  assert.deepEqual(result.record.failed_jobs, [{ job: 'reminders', state: 'missing' }]);
});

test('monitor does not print upstream errors or credentials', async () => {
  const result = await exercise(503, { ok: false, error: privateText });
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'invalid_result');
  assert(!result.stdout.includes(privateText));
  assert(!result.stderr.includes(privateText));
  assert(!result.stdout.includes(secret));
});

test('monitor rejects inconsistent healthy response', async () => {
  const result = await exercise(200, { ...response(), ok: false });
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'invalid_result');
});

test('monitor rejects missing configuration before any request', async () => {
  const result = await exercise(200, response(), { CRON_SECRET: '' });
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'configuration_failed');
  assert.equal(result.seen.length, 0);
});

test('enabled monitor submits unhealthy observation to alert delivery before exit', async () => {
  const result = await exercise(503, response('failed'), { CRON_ALERT_ENABLED: '1' });
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'unhealthy');
  assert.deepEqual(result.seen, [
    { method: 'GET', path: '/api/cron/health', authorized: true },
    { method: 'POST', path: '/api/cron/health/alerts', authorized: true },
  ]);
});

test('alert delivery failure is not reported as healthy', async () => {
  const result = await exercise(200, response(), { CRON_ALERT_ENABLED: '1' }, 503);
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'alert_failed');
  assert.equal(result.record.http_status, 503);
  assert(!result.stdout.includes(secret));
});

const infraEnv = {
  INFRA_ALERT_ENABLED: '1',
  INFRA_ALERT_RESEND_API_KEY: 'synthetic-send-only-key',
  INFRA_ALERT_FROM: 'Operations <alerts@notify.example.com>',
  INFRA_ALERT_TO_EMAIL: 'oncall@example.com',
  INFRA_ALERT_TEST_NOW: '2026-10-01T00:15:00.000Z',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
};

test('Web failure sends one direct infrastructure alert with stable private-free payload', async () => {
  const first = await exercise(500, { error: privateText }, infraEnv);
  const second = await exercise(500, { error: privateText }, infraEnv);
  assert.equal(first.code, 1);
  assert.equal(first.record.status, 'http_failed');
  assert.equal(first.record.infra_alert, 'accepted');
  assert.equal(first.emails.length, 1);
  assert.equal(first.emails[0].authorized, true);
  assert.equal(first.emails[0].idempotencyKey, 'infra-health-staging-2026100100');
  assert.deepEqual(first.emails[0].payload, second.emails[0].payload);
  assert.equal(first.emails[0].idempotencyKey, second.emails[0].idempotencyKey);
  assert(!JSON.stringify(first.emails).includes(privateText));
  assert(!first.stdout.includes('synthetic-send-only-key'));
  assert(!first.stdout.includes(privateText));
});

test('Web connection refusal still sends direct infrastructure alert', async () => {
  const result = await exercise(200, response(), { ...infraEnv, APP_URL: 'http://127.0.0.1:1' });
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'request_failed');
  assert.equal(result.record.infra_alert, 'accepted');
  assert.equal(result.seen.length, 0);
  assert.equal(result.emails.length, 1);
});

test('valid unhealthy Web response uses existing alert path without direct fallback', async () => {
  const result = await exercise(503, response('failed'), {
    ...infraEnv,
    CRON_ALERT_ENABLED: '1',
  });
  assert.equal(result.record.status, 'unhealthy');
  assert.equal(result.emails.length, 0);
  assert.equal(result.seen.length, 2);
});

test('Web alert API failure falls back to direct infrastructure alert', async () => {
  const result = await exercise(200, response(), {
    ...infraEnv,
    CRON_ALERT_ENABLED: '1',
  }, 503);
  assert.equal(result.code, 1);
  assert.equal(result.record.status, 'alert_failed');
  assert.equal(result.record.infra_alert, 'accepted');
  assert.equal(result.emails.length, 1);
});

test('provider rejection stays failed and never logs provider body or key', async () => {
  const result = await exercise(500, { error: privateText }, infraEnv, 200, 422);
  assert.equal(result.code, 1);
  assert.equal(result.record.infra_alert, 'send_failed');
  assert.equal(result.emails.length, 1);
  assert(!result.stdout.includes(privateText));
  assert(!result.stdout.includes('synthetic-send-only-key'));
  assert(!result.stderr.includes(privateText));
});
