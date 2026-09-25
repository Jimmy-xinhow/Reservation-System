import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const assetListPath = 'docs/g3-03-authenticated-asset-paths-current-2026-09-24.json';
const outputPath = 'docs/g3-03-authenticated-asset-scan-2026-09-24.json';
const project = '09914d62-2d30-4e30-bca8-3d0a718f24be';
const environment = '4e5658f0-ed9c-44c5-9ae8-4a45c431a918';
const service = 'a2a21779-4078-4a8b-b841-438f0ef52d7c';

function railway(...args) {
  const command = spawnSync('powershell.exe', ['-NoProfile', '-Command', `railway ${args.join(' ')}`],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(command.status, 0, 'Cannot read staging Railway state; raw output suppressed');
  try { return JSON.parse(command.stdout); } catch { throw new Error('Invalid staging Railway response'); }
}

const assets = JSON.parse(readFileSync(assetListPath, 'utf8'));
assert.equal(assets.environment, 'Railway staging');
assert.ok(Array.isArray(assets.routes) && assets.routes.length > 0);
assert.ok(Array.isArray(assets.assetPaths) && assets.assetPaths.length > 0);
const deployments = railway('deployment', 'list', '--project', project, '--environment', environment,
  '--service', service, '--json');
assert.equal(deployments[0]?.id, assets.deployment, 'Authenticated paths do not match active staging Web');
assert.equal(deployments[0]?.status, 'SUCCESS', 'Active staging Web is not successful');
const config = railway('variables', '--project', project, '--environment', environment,
  '--service', service, '--json');
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, 'ongjsegewpnbkqugrpom.supabase.co');

const secretNames = [
  'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'BROWSER_BOOKING_SECRET',
  'REGISTRATION_TOKEN_SECRET', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRETS_JSON', 'LINE_CHANNEL_ACCESS_TOKENS_JSON',
  'ECPAY_HASH_KEY', 'ECPAY_HASH_IV', 'NEWEBPAY_HASH_KEY', 'NEWEBPAY_HASH_IV',
  'RESEND_API_KEY',
];
const secrets = secretNames.flatMap((name) => typeof config[name] === 'string' && config[name].length >= 8
  ? [[name, config[name]]] : []);
assert.ok(secrets.some(([name]) => name === 'SUPABASE_SERVICE_ROLE_KEY'));
for (const name of ['LINE_CHANNEL_SECRETS_JSON', 'LINE_CHANNEL_ACCESS_TOKENS_JSON']) {
  if (!config[name]) continue;
  let channelMap;
  try { channelMap = JSON.parse(config[name]); } catch { throw new Error('Invalid channel map; raw configuration suppressed'); }
  for (const value of Object.values(channelMap)) {
    if (typeof value === 'string' && value.length >= 8) secrets.push([`${name} entry`, value]);
  }
}

const findings = [];
const artifacts = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function scan(label, source) {
  const body = source.toString('utf8');
  for (const [name, value] of secrets) {
    if (body.includes(value) || body.includes(encodeURIComponent(value))) {
      findings.push({ path: label, kind: 'configured-secret', key: name });
    }
  }
  for (const match of body.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url')).role === 'service_role') {
        findings.push({ path: label, kind: 'service-role-jwt' });
      }
    } catch { /* Not a JWT with decodable claims. */ }
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) {
    findings.push({ path: label, kind: 'private-key' });
  }
  artifacts.push({ path: label, bytes: source.length, sha256: hash(source) });
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const localAssets = walk('.next/static').filter((path) => /\.(?:js|map)$/.test(path));
for (const path of localAssets) scan(`local:${relative('.next', path).replaceAll('\\', '/')}`, readFileSync(path));
const livePaths = new Set(assets.assetPaths);
const publicRoutes = [
  '/', '/book', '/book/browser', '/book/browser/my', '/book/browser/reschedule',
  '/book/reschedule', '/register', '/register/my', '/register/pay', '/register/cancel',
  '/membership', '/my', '/payment/result', '/embed/book', '/embed/register',
  '/admin/login', '/line/account-link',
];
for (const route of publicRoutes) {
  const response = await fetch(`${base}${route}?clinic_slug=demo-beauty`, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `Public page unavailable: ${route}`);
  const body = Buffer.from(await response.arrayBuffer());
  scan(`live-html:${route}`, body);
  for (const match of body.toString('utf8').matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    const script = new URL(match[1].replaceAll('&amp;', '&'), base);
    if (script.origin === base && /^\/_next\/static\/[a-zA-Z0-9/_-]+\.js$/.test(script.pathname)) {
      livePaths.add(script.pathname);
    }
  }
}
for (const path of livePaths) {
  assert.match(path, /^\/_next\/static\/[a-zA-Z0-9/_-]+\.js$/);
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `Live script unavailable: ${path}`);
  scan(`live:${path}`, Buffer.from(await response.arrayBuffer()));
}

const report = {
  capturedAt: new Date().toISOString(), deployment: assets.deployment,
  authenticatedRoutesObserved: assets.routes.length,
  authenticatedScriptsObserved: new Set(assets.assetPaths).size,
  publicHtmlScanned: publicRoutes.length,
  totalLiveScriptsScanned: livePaths.size,
  localJsAndMaps: localAssets.length,
  configuredSecretNamesChecked: [...new Set(secrets.map(([name]) => name))],
  missingSecretNames: secretNames.filter((name) => !secrets.some(([present]) => present === name)),
  findings, artifacts,
  limitations: [
    'Vault secret values were not read',
    'Only JavaScript observed in the four-role browser session was fetched; unvisited lazy chunks are not proven clean',
    'Local complete static build is not byte-identical to Railway build',
    'This does not validate authenticated server-rendered PII or real LINE identity',
  ],
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ deployment: report.deployment, authenticatedRoutesObserved: report.authenticatedRoutesObserved,
  authenticatedScriptsObserved: report.authenticatedScriptsObserved, publicHtmlScanned: report.publicHtmlScanned,
  totalLiveScriptsScanned: report.totalLiveScriptsScanned, localJsAndMaps: report.localJsAndMaps,
  configuredSecretNamesChecked: report.configuredSecretNamesChecked, findings: report.findings }));
assert.equal(findings.length, 0);
