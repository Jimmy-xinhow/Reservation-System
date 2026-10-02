import { createClient } from '@supabase/supabase-js';

const expectedHost = 'cmoacgcbxllfpwhiidsx.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Production read-only payment-link audit guard failed');
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

const hasLegacyPayload = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length > 0 && value.receipt_version !== 1;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => [name, canonical(child)]));
  }
  return value;
}

function privateSignalFlags(value) {
  const flags = {
    personalField: false, callbackSignatureField: false, providerAuthorizationCodeField: false,
    secretOrTokenField: false, emailValue: false,
    taiwanMobileValue: false, lineUserIdValue: false, jwtValue: false, privateKeyValue: false,
  };
  const visit = node => {
    if (typeof node === 'string') {
      if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(node)) flags.emailValue = true;
      if (/(?:^|\D)(?:09\d{8}|\+?886[- ]?9\d{8})(?:\D|$)/.test(node)) flags.taiwanMobileValue = true;
      if (/\bU[a-f0-9]{32}\b/i.test(node)) flags.lineUserIdValue = true;
      if (/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(node)) flags.jwtValue = true;
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(node)) flags.privateKeyValue = true;
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    for (const [name, child] of Object.entries(node)) {
      if (/(?:name|email|phone|mobile|address|identity|national.?id)/i.test(name)) flags.personalField = true;
      if (/(?:signature|check.?mac|hash.?value)/i.test(name)) flags.callbackSignatureField = true;
      if (/(?:auth.?code|authorization)/i.test(name)) flags.providerAuthorizationCodeField = true;
      if (/(?:secret|token|password|private.?key)/i.test(name)) flags.secretOrTokenField = true;
      visit(child);
    }
  };
  visit(value);
  return flags;
}

const [webhooks, transactions, orders, statusEvents] = await Promise.all([
  readAll('payment_webhook_events', 'id,clinic_id,provider,event_key,payload'),
  readAll('payment_transactions', 'id,clinic_id,payment_order_id,event_key,status,payload'),
  readAll('payment_orders', 'id,clinic_id,provider,status,provider_payload'),
  readAll('payment_status_events', 'id,clinic_id,payment_order_id,to_status'),
]);
const legacyWebhooks = webhooks.filter(row => hasLegacyPayload(row.payload));
const legacyTransactions = transactions.filter(row => hasLegacyPayload(row.payload));
const legacyOrders = orders.filter(row => hasLegacyPayload(row.provider_payload?.last_event));
const orderById = new Map(orders.map(row => [row.id, row]));
const webhookByEvent = new Map(webhooks.map(row => [`${row.provider}:${row.event_key}`, row]));
const paidAudits = new Set(statusEvents.filter(row => row.to_status === 'paid').map(row => `${row.clinic_id}:${row.payment_order_id}`));

const links = legacyTransactions.map(transaction => {
  const order = orderById.get(transaction.payment_order_id);
  const webhook = order ? webhookByEvent.get(`${order.provider}:${transaction.event_key}`) : null;
  const sameTenant = Boolean(order && order.clinic_id === transaction.clinic_id
    && webhook && webhook.clinic_id === transaction.clinic_id);
  const allLegacy = Boolean(order && webhook && hasLegacyPayload(order.provider_payload?.last_event)
    && hasLegacyPayload(webhook.payload));
  const payloadsEqual = allLegacy
    && JSON.stringify(canonical(transaction.payload)) === JSON.stringify(canonical(webhook.payload))
    && JSON.stringify(canonical(transaction.payload)) === JSON.stringify(canonical(order.provider_payload.last_event));
  return {
    hasOrder: Boolean(order), hasWebhook: Boolean(webhook), sameTenant, allLegacy, payloadsEqual,
    acceptedPaidWithAudit: Boolean(order?.status === 'paid' && transaction.status === 'accepted'
      && paidAudits.has(`${transaction.clinic_id}:${transaction.payment_order_id}`)),
  };
});
const signals = legacyTransactions.map(row => privateSignalFlags(row.payload));

const report = {
  auditedAt: new Date().toISOString(),
  environment: 'production',
  supabaseHost: expectedHost,
  readOnly: true,
  rawPayloadsPrinted: false,
  recordIdentifiersPrinted: false,
  legacyCounts: {
    webhook: legacyWebhooks.length,
    transaction: legacyTransactions.length,
    orderLastEvent: legacyOrders.length,
  },
  transactionLinks: {
    total: links.length,
    orderFound: links.filter(link => link.hasOrder).length,
    webhookFound: links.filter(link => link.hasWebhook).length,
    sameTenant: links.filter(link => link.sameTenant).length,
    allThreeLocationsLegacy: links.filter(link => link.allLegacy).length,
    allThreePayloadsEqual: links.filter(link => link.payloadsEqual).length,
    acceptedPaidWithPaidAudit: links.filter(link => link.acceptedPaidWithAudit).length,
  },
  legacyTransactionPrivacySignals: Object.fromEntries(Object.keys(signals[0] ?? privateSignalFlags(null))
    .map(name => [name, signals.filter(row => row[name]).length])),
  privacySignalLimit: 'Pattern checks can miss sensitive values and do not establish legal retention requirements.',
  unresolved: ['retention policy', 'raw-value privacy review', 'reversible data conversion', 'production write approval'],
};
console.log(JSON.stringify(report, null, 2));
