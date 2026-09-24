import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const expectedHost = 'cmoacgcbxllfpwhiidsx.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Production read-only payment-receipt dry-run guard failed');
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

const legacy = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length > 0 && value.receipt_version !== 1;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => [name, canonical(child)]))
    : value;
const serialized = value => JSON.stringify(canonical(value));
const byteLength = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

const [orders, transactions, webhooks, statusEvents] = await Promise.all([
  readAll('payment_orders', 'id,clinic_id,provider,merchant_order_no,amount,status,provider_payload'),
  readAll('payment_transactions', 'id,clinic_id,payment_order_id,event_key,status,provider_transaction_no,payload'),
  readAll('payment_webhook_events', 'id,clinic_id,provider,event_key,payload'),
  readAll('payment_status_events', 'id,clinic_id,payment_order_id,to_status'),
]);
const ordersById = new Map(orders.map(row => [row.id, row]));
const webhooksByEvent = new Map(webhooks.map(row => [`${row.provider}:${row.event_key}`, row]));
const paidAudits = new Set(statusEvents.filter(row => row.to_status === 'paid')
  .map(row => `${row.clinic_id}:${row.payment_order_id}`));
const legacyTransactions = transactions.filter(row => legacy(row.payload));
const legacyOrders = orders.filter(row => legacy(row.provider_payload?.last_event));
const legacyWebhooks = webhooks.filter(row => legacy(row.payload));
const candidates = [];

for (const transaction of legacyTransactions) {
  const order = ordersById.get(transaction.payment_order_id);
  const webhook = order ? webhooksByEvent.get(`${order.provider}:${transaction.event_key}`) : null;
  if (!order || !webhook || order.clinic_id !== transaction.clinic_id || webhook.clinic_id !== transaction.clinic_id
    || !legacy(order.provider_payload?.last_event) || !legacy(webhook.payload)
    || serialized(transaction.payload) !== serialized(webhook.payload)
    || serialized(transaction.payload) !== serialized(order.provider_payload.last_event)
    || order.status !== 'paid' || transaction.status !== 'accepted'
    || !paidAudits.has(`${order.clinic_id}:${order.id}`)
    || typeof order.merchant_order_no !== 'string' || !Number.isInteger(order.amount)
    || !['ecpay', 'newebpay'].includes(order.provider)) {
    throw new Error('Legacy payment dry-run precondition failed; no candidate is approved');
  }
  const receipt = {
    receipt_version: 1,
    provider: order.provider,
    merchant_order_no: order.merchant_order_no,
    provider_transaction_no: transaction.provider_transaction_no,
    event_key: transaction.event_key,
    success: true,
    amount: order.amount,
    // JSONB does not retain original callback byte ordering. This fingerprints
    // the persisted legacy object and must not be described as original bytes.
    payload_sha256: createHash('sha256').update(JSON.stringify(transaction.payload)).digest('hex'),
  };
  const convertedOrderPayload = { ...order.provider_payload, last_event: receipt };
  candidates.push({
    sourceBytes: byteLength(transaction.payload) + byteLength(webhook.payload) + byteLength(order.provider_payload),
    projectedBytes: byteLength(receipt) * 2 + byteLength(convertedOrderPayload),
    completeReceipt: Object.keys(receipt).length === 8 && receipt.payload_sha256.length === 64,
    otherOrderKeysPreserved: Object.keys(order.provider_payload)
      .filter(name => name !== 'last_event').every(name => serialized(order.provider_payload[name]) === serialized(convertedOrderPayload[name])),
  });
}

if (legacyOrders.length !== candidates.length || legacyWebhooks.length !== candidates.length
  || candidates.some(row => !row.completeReceipt || !row.otherOrderKeysPreserved)) {
  throw new Error('Legacy payment dry-run population mismatch; no candidate is approved');
}

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(), environment: 'production', supabaseHost: expectedHost,
  readOnly: true, rawPayloadsPrinted: false, identifiersPrinted: false,
  eligibleLinkedTransactions: candidates.length,
  projectedReceiptCopies: candidates.length * 3,
  preservedOtherOrderKeys: candidates.every(row => row.otherOrderKeysPreserved),
  totalStoredJsonBytesBefore: candidates.reduce((sum, row) => sum + row.sourceBytes, 0),
  projectedStoredJsonBytesAfter: candidates.reduce((sum, row) => sum + row.projectedBytes, 0),
  hashMeaning: 'SHA-256 of persisted JSONB object, not the original HTTP callback bytes',
  requiredBeforeAnyWrite: ['approved retention policy', 'reversible encrypted backup', 'production migration review'],
}, null, 2));
