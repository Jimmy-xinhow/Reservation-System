import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const expectedHost = 'cmoacgcbxllfpwhiidsx.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.platform !== 'win32' || process.env.RAILWAY_ENVIRONMENT_NAME !== 'production'
  || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Production legacy-payment backup guard failed');
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function readAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 499);
    if (error || !Array.isArray(data)) throw new Error(`Read-only query failed: ${table} (${error?.code ?? 'invalid_response'})`);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

const [orders, transactions, webhooks, statusEvents] = await Promise.all([
  readAll('payment_orders', 'id,clinic_id,provider,merchant_order_no,amount,status,provider_payload'),
  readAll('payment_transactions', 'id,clinic_id,payment_order_id,event_key,status,provider_transaction_no,payload'),
  readAll('payment_webhook_events', 'id,clinic_id,provider,event_key,payload'),
  readAll('payment_status_events', 'id,clinic_id,payment_order_id,to_status'),
]);
const legacy = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length > 0 && value.receipt_version !== 1;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => [name, canonical(child)]))
    : value;
const serialized = value => JSON.stringify(canonical(value));
const byOrder = new Map(orders.map(row => [row.id, row]));
const byEvent = new Map(webhooks.map(row => [`${row.provider}:${row.event_key}`, row]));
const paidAudits = new Set(statusEvents.filter(row => row.to_status === 'paid')
  .map(row => `${row.clinic_id}:${row.payment_order_id}`));
const candidates = [];
for (const transaction of transactions.filter(row => legacy(row.payload))) {
  const order = byOrder.get(transaction.payment_order_id);
  const webhook = order ? byEvent.get(`${order.provider}:${transaction.event_key}`) : null;
  if (!order || !webhook || order.clinic_id !== transaction.clinic_id
    || webhook.clinic_id !== transaction.clinic_id || !legacy(order.provider_payload?.last_event)
    || !legacy(webhook.payload) || serialized(transaction.payload) !== serialized(webhook.payload)
    || serialized(transaction.payload) !== serialized(order.provider_payload.last_event)
    || order.status !== 'paid' || transaction.status !== 'accepted'
    || !paidAudits.has(`${order.clinic_id}:${order.id}`)
    || !['ecpay', 'newebpay'].includes(order.provider)) {
    throw new Error('Payment backup precondition failed; no snapshot was written');
  }
  candidates.push({ order, transaction, webhook });
}
if (candidates.length !== 2 || orders.filter(row => legacy(row.provider_payload?.last_event)).length !== 2
  || webhooks.filter(row => legacy(row.payload)).length !== 2) {
  throw new Error('Payment backup population drifted; no snapshot was written');
}

const createdAt = new Date();
const expiresAt = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
const snapshot = JSON.stringify({
  version: 1, productionHost: expectedHost, createdAt: createdAt.toISOString(),
  expiresAt: expiresAt.toISOString(), items: candidates,
});
const plaintextSha256 = createHash('sha256').update(snapshot).digest('hex');
const filename = `g303-payment-legacy-${createdAt.toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.dpapi`;
const backupPath = join(process.cwd(), '.local-backups', filename);
const helper = join(process.cwd(), 'scripts', 'private-payment-snapshot.ps1');
function callHelper(mode, input, ...args) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Mode', mode, '-Path', backupPath, ...args], { input, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    const diagnostics = ['Invalid snapshot structure or expiry', 'SetAccessControl',
      'ProtectedData', 'ConvertFrom-Json', 'Snapshot path', 'Snapshot already exists',
      'Snapshot restore check failed', 'Cannot convert', 'OutOfMemory']
      .filter(signal => result.stderr?.includes(signal));
    const errorId = result.stderr?.match(/FullyQualifiedErrorId\s*:\s*([A-Za-z0-9_.]+)/)?.[1];
    throw new Error(`Private snapshot ${mode} failed (${result.error?.code ?? result.status}; ${diagnostics.join(',') || 'unclassified'}; ${errorId ?? 'no-error-id'}; stderr-bytes=${result.stderr?.length ?? 0})`);
  }
  try { return JSON.parse(result.stdout.trim()); }
  catch { throw new Error(`Private snapshot ${mode} returned invalid metadata`); }
}

const backup = callHelper('Backup', snapshot);
if (!backup.restoredInMemory || backup.plaintextSha256 !== plaintextSha256
  || backup.expiresAt !== expiresAt.toISOString()) {
  throw new Error('Backup metadata mismatch; do not modify production data');
}
const verification = callHelper('Verify', '', '-ExpectedSha256', plaintextSha256);
if (!verification.restoredInMemory || !verification.plaintextSha256Matched || verification.itemCount !== 2
  || verification.encryptedSha256 !== backup.encryptedSha256) {
  throw new Error('Independent backup verification failed; do not modify production data');
}
const manifestPath = `${backupPath}.meta.json`;
writeFileSync(manifestPath, JSON.stringify({ version: 1, backupPath, createdAt: createdAt.toISOString(),
  expiresAt: expiresAt.toISOString(), plaintextSha256, encryptedSha256: backup.encryptedSha256,
  protection: backup.protection, itemCount: 2 }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ readOnlyProduction: true, encryptedBackupCreated: true,
  restoreVerifiedInMemory: true, itemCount: 2, storedPayloadCopies: 6,
  expiresAt: expiresAt.toISOString(), backupPath, manifestPath,
  protection: backup.protection, keyDependency: 'same Windows user profile on this computer',
  productionRowsChanged: 0 }, null, 2));
