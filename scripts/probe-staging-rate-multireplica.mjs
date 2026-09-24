const deployment = '437485c4-0adf-4c7c-b8f6-d12f5c49ee4d';
if (process.env.G303_EXPECTED_STAGING_DEPLOYMENT !== deployment) {
  throw new Error('Staging deployment guard failed');
}

const url = 'https://reservation-system-staging-staging.up.railway.app/api/membership/portal?clinic_slug=staging-test';
const statuses = [];
for (let index = 0; index < 12; index += 1) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'x-forwarded-for': `198.51.100.${index + 40}`,
      'x-real-ip': `203.0.113.${index + 40}`,
    },
    body: '{}',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  statuses.push(response.status);
}

const passed = statuses.every((status, index) => index < 8
  ? [400, 403, 404].includes(status)
  : status === 429);
console.log(JSON.stringify({deployment, passed, statuses,
  businessWrites: 0, note: 'replica evidence requires separate Railway HTTP log confirmation'}));
if (!passed) process.exitCode = 1;
