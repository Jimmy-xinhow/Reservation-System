// Read-only Railway cron monitor. The Web API keeps database credentials server-side.
const secret = process.env.CRON_SECRET;
const appUrl = process.env.APP_URL;
const jobs = new Set([
  'reminders', 'marketing', 'membership', 'followups', 'registration',
  'richmenu', 'subscription-freezes',
]);
const states = new Set(['healthy', 'failed', 'stale', 'missing', 'invalid_time']);
const at = () => new Date().toISOString();
function record(status, details = {}) {
  console.log(JSON.stringify({ event: 'cron_monitor', status, at: at(), ...details }));
}

let target;
try {
  if (!secret || !appUrl) throw new Error('configuration');
  const base = new URL(appUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) {
    throw new Error('configuration');
  }
  target = new URL('/api/cron/health', base);
} catch {
  record('configuration_failed');
  process.exit(1);
}

try {
  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (response.status !== 200 && response.status !== 503) {
    record('http_failed', { http_status: response.status });
    process.exit(1);
  }
  const body = await response.json().catch(() => null);
  const rows = body?.jobs;
  if (!Array.isArray(rows) || rows.length !== jobs.size ||
      rows.some(row => !row || typeof row !== 'object' || !jobs.has(row.job) || !states.has(row.state)) ||
      new Set(rows.map(row => row.job)).size !== jobs.size ||
      body.ok !== rows.every(row => row.state === 'healthy') ||
      response.status !== (body.ok ? 200 : 503)) {
    record('invalid_result', { http_status: response.status });
    process.exit(1);
  }
  const unhealthy = rows.filter(row => row.state !== 'healthy');
  record(unhealthy.length ? 'unhealthy' : 'healthy', {
    jobs: rows.length,
    ...(unhealthy.length ? { failed_jobs: unhealthy.map(row => ({ job: row.job, state: row.state })) } : {}),
  });
  process.exit(unhealthy.length ? 1 : 0);
} catch {
  record('request_failed');
  process.exit(1);
}
