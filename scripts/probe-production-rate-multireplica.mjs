const deployment = 'ee136a69-c8e8-46b3-855f-4f65cfd9d8ab';
if (process.env.G303_EXPECTED_PRODUCTION_DEPLOYMENT !== deployment) {
  throw new Error('Production deployment guard failed');
}

const url = 'https://reservation-system-production-9b71.up.railway.app/api/membership/portal?clinic_slug=demo-beauty';
const statuses = [];
for (let index = 0; index < 12; index += 1) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'x-forwarded-for': `198.51.100.${index + 70}`,
      'x-real-ip': `203.0.113.${index + 70}`,
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
