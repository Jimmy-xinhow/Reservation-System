// Railway cron monitor. The Web API keeps database credentials server-side.
// A separately configured Resend fallback reports Web/DB outages without calling Web.
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

const emailAddress = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

async function sendInfrastructureAlert() {
  if (process.env.INFRA_ALERT_ENABLED !== '1') return 'disabled';
  const key = process.env.INFRA_ALERT_RESEND_API_KEY ?? '';
  const from = process.env.INFRA_ALERT_FROM ?? '';
  const to = process.env.INFRA_ALERT_TO_EMAIL ?? '';
  const sender = /<([^<>]+)>$/.exec(from)?.[1] ?? from;
  if (!key || from.length > 160 || /[\r\n]/.test(from) || !emailAddress.test(sender) ||
      !emailAddress.test(to)) return 'not_configured';

  const rawEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME ?? '';
  const environment = /^[a-z0-9_-]{1,40}$/i.test(rawEnvironment) ? rawEnvironment : 'unknown';
  const testNow = process.env.NODE_ENV === 'test' ? process.env.INFRA_ALERT_TEST_NOW : null;
  const now = testNow && !Number.isNaN(Date.parse(testNow)) ? new Date(testNow) : new Date();
  const hour = now.toISOString().slice(0, 13);
  const payload = {
    from,
    to: [to],
    subject: `[${environment}] 平台健康監測無法完成`,
    html: `<p>${environment} 的平台健康監測無法完成，請檢查 Web、資料庫與告警 API。</p><p>觀察時段（UTC）：${hour}:00。</p><p>本信不含品牌或顧客資料。</p>`,
  };
  const testEndpoint = process.env.NODE_ENV === 'test' ? process.env.INFRA_ALERT_TEST_ENDPOINT ?? '' : '';
  const endpoint = /^http:\/\/127\.0\.0\.1:\d+\/emails$/.test(testEndpoint)
    ? testEndpoint : 'https://api.resend.com/emails';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `infra-health-${environment}-${hour.replace(/[-T:]/g, '')}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    return response.ok ? 'accepted' : 'send_failed';
  } catch {
    return 'send_failed';
  }
}

async function stopOnFailure(status, details = {}) {
  const infraAlert = await sendInfrastructureAlert();
  record(status, { ...details, infra_alert: infraAlert });
  process.exit(1);
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
  await stopOnFailure('configuration_failed');
}

try {
  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (response.status !== 200 && response.status !== 503) {
    await stopOnFailure('http_failed', { http_status: response.status });
  }
  const body = await response.json().catch(() => null);
  const rows = body?.jobs;
  if (!Array.isArray(rows) || rows.length !== jobs.size ||
      rows.some(row => !row || typeof row !== 'object' || !jobs.has(row.job) || !states.has(row.state)) ||
      new Set(rows.map(row => row.job)).size !== jobs.size ||
      body.ok !== rows.every(row => row.state === 'healthy') ||
      response.status !== (body.ok ? 200 : 503)) {
    await stopOnFailure('invalid_result', { http_status: response.status });
  }
  if (process.env.CRON_ALERT_ENABLED === '1') {
    let alertResponse;
    try {
      // The alert endpoint records seven jobs and drains deliveries. It can outlast
      // the read-only health check without indicating a Web/DB outage.
      alertResponse = await fetch(new URL('/api/cron/health/alerts', target), {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
    } catch {
      await stopOnFailure('alert_request_failed');
    }
    if (alertResponse.status !== 200) {
      await stopOnFailure('alert_failed', { http_status: alertResponse.status });
    }
  }
  const unhealthy = rows.filter(row => row.state !== 'healthy');
  record(unhealthy.length ? 'unhealthy' : 'healthy', {
    jobs: rows.length,
    ...(unhealthy.length ? { failed_jobs: unhealthy.map(row => ({ job: row.job, state: row.state })) } : {}),
  });
  process.exit(unhealthy.length ? 1 : 0);
} catch {
  await stopOnFailure('request_failed');
}
