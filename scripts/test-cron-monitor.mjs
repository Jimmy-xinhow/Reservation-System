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

async function exercise(status, body, envOverride = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, path: req.url, authorized: req.headers.authorization === `Bearer ${secret}` });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = { ...process.env, APP_URL: `http://127.0.0.1:${server.address().port}`, CRON_SECRET: secret, ...envOverride };
    const child = spawn(process.execPath, ['scripts/monitor-cron-health.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    return { code, stdout, stderr, seen, record: JSON.parse(stdout.trim()) };
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
