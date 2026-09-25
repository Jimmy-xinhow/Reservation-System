import { createClient } from '@supabase/supabase-js';

const expectedHost = 'cmoacgcbxllfpwhiidsx.supabase.co';
const environment = process.env.RAILWAY_ENVIRONMENT_NAME;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (environment !== 'production' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Production read-only audit guard failed');
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readAll(table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from(table).select(columns).order('id').range(offset, offset + 499);
    if (error || !Array.isArray(data)) {
      throw new Error(`Read-only audit query failed: ${table} (${error?.code ?? 'invalid_response'})`);
    }
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

async function count(table, configure = query => query) {
  const { count: total, error } = await configure(db.from(table).select('id', { count: 'exact', head: true }));
  if (error || typeof total !== 'number') {
    throw new Error(`Read-only audit count failed: ${table} (${error?.code ?? 'invalid_response'})`);
  }
  return total;
}

const [orders, transactions, statusEvents, webhookEvents, crmErrors, followupErrors, importJobs,
  nonemptyWebhookPayloads, versionedWebhookPayloads, nonemptyTransactionPayloads,
  versionedTransactionPayloads, legacyOrderLastEvents, versionedOrderLastEvents] = await Promise.all([
  readAll('payment_orders', 'id,clinic_id,status'),
  readAll('payment_transactions', 'id,payment_order_id,clinic_id,status'),
  readAll('payment_status_events', 'id,payment_order_id,clinic_id,to_status'),
  count('payment_webhook_events'),
  count('crm_delivery_logs', query => query.not('error', 'is', null)),
  count('scheduled_followups', query => query.not('last_error', 'is', null)),
  count('data_import_jobs'),
  count('payment_webhook_events', query => query.not('payload', 'eq', '{}')),
  count('payment_webhook_events', query => query.not('payload', 'eq', '{}').eq('payload->>receipt_version', '1')),
  count('payment_transactions', query => query.not('payload', 'eq', '{}')),
  count('payment_transactions', query => query.not('payload', 'eq', '{}').eq('payload->>receipt_version', '1')),
  count('payment_orders', query => query.not('provider_payload->last_event', 'is', null)),
  count('payment_orders', query => query.eq('provider_payload->last_event->>receipt_version', '1')),
]);

const accepted = new Set(transactions.filter(row => row.status === 'accepted').map(row => `${row.clinic_id}:${row.payment_order_id}`));
const paidAudited = new Set(statusEvents.filter(row => row.to_status === 'paid').map(row => `${row.clinic_id}:${row.payment_order_id}`));
const paidWithAccepted = orders.filter(row => row.status === 'paid' && accepted.has(`${row.clinic_id}:${row.id}`));

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  environment: 'production',
  supabaseHost: expectedHost,
  rawValuesPrinted: false,
  payment: {
    orders: orders.length,
    paidOrders: orders.filter(row => row.status === 'paid').length,
    transactions: transactions.length,
    acceptedTransactions: transactions.filter(row => row.status === 'accepted').length,
    statusEvents: statusEvents.length,
    webhookEvents,
    paidOrdersWithAcceptedTransactions: paidWithAccepted.length,
    paidWithAcceptedTransactionMissingPaidAudit: paidWithAccepted.filter(row => !paidAudited.has(`${row.clinic_id}:${row.id}`)).length,
    nonemptyLegacyWebhookPayloads: nonemptyWebhookPayloads - versionedWebhookPayloads,
    nonemptyLegacyTransactionPayloads: nonemptyTransactionPayloads - versionedTransactionPayloads,
    legacyOrderLastEvents: legacyOrderLastEvents - versionedOrderLastEvents,
  },
  historicalErrorSources: {
    crmDeliveryErrorRows: crmErrors,
    followupErrorRows: followupErrors,
    importJobs,
  },
  pending: ['legacy payload contents and retention decisions', 'full production audit reconciliation'],
}, null, 2));
