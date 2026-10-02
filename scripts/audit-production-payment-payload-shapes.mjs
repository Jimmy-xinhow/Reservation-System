import { createClient } from '@supabase/supabase-js';

const expectedHost = 'cmoacgcbxllfpwhiidsx.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Production read-only payment-shape audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function readAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 499);
    if (error || !Array.isArray(data)) throw new Error(`Read-only shape query failed: ${table} (${error?.code ?? 'invalid_response'})`);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

const keyGroups = {
  personal: /(?:email|phone|mobile|name|address|birthday|identity)/i,
  credential: /(?:secret|token|password|auth|private.?key)/i,
  payment: /(?:card|bank|trade|merchant|payment|payer|amount)/i,
  rawEnvelope: /(?:payload|response|request|body|raw|data)/i,
};

function describe(value) {
  const summary = { topLevelKeys: 0, nestedObjects: 0, stringsOver64: 0, stringsOver256: 0, groups: { personal: false, credential: false, payment: false, rawEnvelope: false } };
  const seen = new WeakSet();
  function visit(node, depth) {
    if (typeof node === 'string') {
      if (node.length > 64) summary.stringsOver64 += 1;
      if (node.length > 256) summary.stringsOver256 += 1;
      return;
    }
    if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (depth > 0) summary.nestedObjects += 1;
    for (const [name, child] of Object.entries(node)) {
      if (depth === 0) summary.topLevelKeys += 1;
      for (const [group, pattern] of Object.entries(keyGroups)) {
        if (pattern.test(name)) summary.groups[group] = true;
      }
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
  return summary;
}

function legacy(values) {
  return values.filter(value => value && typeof value === 'object' && Object.keys(value).length > 0 && value.receipt_version !== 1);
}

function aggregate(values) {
  const descriptions = values.map(describe);
  return {
    rows: descriptions.length,
    anyNestedObject: descriptions.filter(item => item.nestedObjects > 0).length,
    anyStringOver64: descriptions.filter(item => item.stringsOver64 > 0).length,
    anyStringOver256: descriptions.filter(item => item.stringsOver256 > 0).length,
    keyGroupRows: Object.fromEntries(Object.keys(keyGroups).map(group => [group, descriptions.filter(item => item.groups[group]).length])),
    topLevelKeyCountBuckets: {
      '1-3': descriptions.filter(item => item.topLevelKeys >= 1 && item.topLevelKeys <= 3).length,
      '4-10': descriptions.filter(item => item.topLevelKeys >= 4 && item.topLevelKeys <= 10).length,
      '11+': descriptions.filter(item => item.topLevelKeys > 10).length,
    },
  };
}

const [webhooks, transactions, orders] = await Promise.all([
  readAll('payment_webhook_events', 'payload'),
  readAll('payment_transactions', 'payload'),
  readAll('payment_orders', 'provider_payload'),
]);
const output = {
  auditedAt: new Date().toISOString(),
  environment: 'production',
  supabaseHost: expectedHost,
  rawValuesPrinted: false,
  rawKeysPrinted: false,
  legacyWebhookPayloads: aggregate(legacy(webhooks.map(row => row.payload))),
  legacyTransactionPayloads: aggregate(legacy(transactions.map(row => row.payload))),
  legacyOrderLastEvents: aggregate(legacy(orders.map(row => row.provider_payload?.last_event))),
};
console.log(JSON.stringify(output, null, 2));
