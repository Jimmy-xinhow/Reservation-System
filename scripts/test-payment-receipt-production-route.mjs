import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const host = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production' || !host
  || new URL(host).host !== 'cmoacgcbxllfpwhiidsx.supabase.co'
  || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Production-only receipt route test guard failed');
}
const db = createClient(host, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = Date.now().toString(36).toUpperCase() + randomBytes(2).toString('hex').toUpperCase();
const marker = 'G303_PRIVATE_CANARY_' + suffix;
const base = 'https://reservation-system-production-9b71.up.railway.app';
if (process.env.G303_EXPECTED_DEPLOYMENT !== 'acab1d99-b57e-4a3a-bdfd-e0d1d12dfd4f') {
  throw new Error('Production deployment guard failed');
}
const created = { patient: null, plan: null, orders: [], events: [] };
let mainError = null;
let summary = null;

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(label + ' (' + (error.code ?? 'unknown') + ')');
  return data;
}
function sign(fields, key, iv) {
  const content = Object.entries(fields)
    .filter(([name]) => name.toLowerCase() !== 'checkmacvalue')
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([name, value]) => name + '=' + value).join('&');
  const encoded = encodeURIComponent('HashKey=' + key + '&' + content + '&HashIV=' + iv)
    .toLowerCase().replace(/%2d/g, '-').replace(/%5f/g, '_')
    .replace(/%2e/g, '.').replace(/%21/g, '!').replace(/%2a/g, '*')
    .replace(/%28/g, '(').replace(/%29/g, ')').replace(/%20/g, '+');
  return createHash('sha256').update(encoded).digest('hex').toUpperCase();
}
async function post(fields) {
  const response = await fetch(base + '/api/payment/ecpay/notify', {
    method: 'POST', body: new URLSearchParams(fields), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.text() };
}
async function cleanup() {
  const errors = [];
  async function remove(label, query) {
    const { error } = await query;
    if (error) errors.push(label + ':' + (error.code ?? 'unknown'));
  }
  for (const id of created.orders) {
    const memberships = await must('membership lookup', db.from('patient_memberships')
      .select('id').eq('payment_order_id', id));
    for (const membership of memberships) {
      await remove('ledger', db.from('membership_ledger').delete().eq('membership_id', membership.id));
      await remove('membership', db.from('patient_memberships').delete().eq('id', membership.id));
    }
    await remove('status', db.from('payment_status_events').delete().eq('payment_order_id', id));
    await remove('transaction', db.from('payment_transactions').delete().eq('payment_order_id', id));
  }
  for (const key of created.events) {
    await remove('webhook', db.from('payment_webhook_events').delete()
      .eq('provider', 'ecpay').eq('event_key', key));
  }
  for (const id of created.orders) {
    await remove('order', db.from('payment_orders').delete().eq('id', id));
  }
  if (created.plan) await remove('plan', db.from('membership_plans').delete().eq('id', created.plan));
  if (created.patient) await remove('patient', db.from('patients').delete().eq('id', created.patient));
  const probes = [];
  if (created.orders.length) {
    for (const table of ['payment_orders', 'payment_transactions', 'payment_status_events',
      'patient_memberships']) {
      const column = table === 'payment_orders' ? 'id' : 'payment_order_id';
      probes.push([table, db.from(table).select('id', { count: 'exact', head: true })
        .in(column, created.orders)]);
    }
    probes.push(['membership_ledger', db.from('membership_ledger')
      .select('id', { count: 'exact', head: true }).in('reference_id', created.orders)]);
  }
  if (created.events.length) probes.push(['payment_webhook_events', db.from('payment_webhook_events')
    .select('id', { count: 'exact', head: true }).eq('provider', 'ecpay')
    .in('event_key', created.events)]);
  if (created.plan) probes.push(['membership_plans', db.from('membership_plans')
    .select('id', { count: 'exact', head: true }).eq('id', created.plan)]);
  if (created.patient) probes.push(['patients', db.from('patients')
    .select('id', { count: 'exact', head: true }).eq('id', created.patient)]);
  for (const [table, query] of probes) {
    const { count, error } = await query;
    if (error || count !== 0) errors.push(table + ':residue');
  }
  if (errors.length) throw new Error('Scoped cleanup failed (' + errors.join(',') + ')');
}
function receipt(value, provider, success) {
  assert.ok(value && typeof value === 'object');
  assert.deepEqual(Object.keys(value).sort(), [
    'amount', 'event_key', 'merchant_order_no', 'payload_sha256',
    'provider', 'provider_transaction_no', 'receipt_version', 'success',
  ]);
  assert.equal(value.receipt_version, 1);
  assert.equal(value.provider, provider);
  assert.equal(value.success, success);
  assert.equal(value.amount, 100);
  assert.match(value.payload_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(value).includes(marker), false);
  assert.equal(JSON.stringify(value).includes('CheckMacValue'), false);
}

try {
  const clinic = await must('brand lookup', db.from('clinics').select('id')
    .eq('slug', 'demo-beauty').maybeSingle());
  const settings = await must('payment configuration', db.from('clinic_payment_settings')
    .select('clinic_id,merchant_id,environment,active').eq('clinic_id', clinic.id).eq('provider', 'ecpay').maybeSingle());
  if (!clinic || !settings || settings.clinic_id !== clinic.id
    || settings.environment !== 'test' || settings.active !== true) {
    throw new Error('Designated production DEMO test merchant unavailable');
  }
  const keys = await must('vault payment secrets', db.rpc('get_clinic_payment_secrets',
    { p_clinic_id: clinic.id }));
  const vaultSecret = Array.isArray(keys) ? keys[0] : null;
  let fallback = null;
  try { fallback = JSON.parse(process.env.PAYMENT_SECRETS_JSON ?? '{}')[clinic.id] ?? null; }
  catch { /* invalid fallback remains unavailable */ }
  const secret = typeof vaultSecret?.hash_key === 'string' && typeof vaultSecret?.hash_iv === 'string'
    ? { hash_key: vaultSecret.hash_key, hash_iv: vaultSecret.hash_iv }
    : { hash_key: fallback?.hashKey, hash_iv: fallback?.hashIv };
  if (typeof secret.hash_key !== 'string' || typeof secret.hash_iv !== 'string') {
    throw new Error('Production DEMO test merchant signing keys unavailable');
  }
  const patient = await must('synthetic patient', db.from('patients').insert({
    clinic_id: clinic.id, name: 'QA G303 receipt ' + suffix,
    phone: '0900000888', marketing_opt_in: false,
  }).select('id').single());
  created.patient = patient.id;
  const plan = await must('synthetic plan', db.from('membership_plans').insert({
    clinic_id: clinic.id, name: 'QA G303 receipt ' + suffix,
    price: 100, credits_total: 1, usage_scope: 'both', active: true,
  }).select('id').single());
  created.plan = plan.id;
  const routeReady = await fetch(base + '/api/payment/ecpay/notify',
    { signal: AbortSignal.timeout(15000) });
  if (routeReady.status !== 405) throw new Error('Production callback route unavailable');
  const cases = [];
  for (const success of [true, false]) {
    const merchantOrder = ('MEMQA' + suffix + (success ? 'S' : 'F')).slice(0, 20);
    const tradeNo = 'QA' + suffix + (success ? 'S' : 'F');
    const eventKey = merchantOrder + ':' + tradeNo + ':' + (success ? '1' : '0');
    const order = await must('synthetic order', db.from('payment_orders').insert({
      clinic_id: clinic.id, membership_plan_id: plan.id, patient_id: patient.id,
      provider: 'ecpay', merchant_order_no: merchantOrder,
      amount: 100, status: 'pending', return_path: '/',
      provider_payload: { fixture_marker: suffix },
    }).select('id').single());
    created.orders.push(order.id);
    created.events.push(eventKey);
    const fields = {
      MerchantID: settings.merchant_id, MerchantTradeNo: merchantOrder,
      TradeNo: tradeNo, RtnCode: success ? '1' : '0', TradeAmt: '100',
      CustomField1: marker,
    };
    fields.CheckMacValue = sign(fields, secret.hash_key, secret.hash_iv);
    const first = await post(fields);
    assert.deepEqual(first, { status: 200, body: '1|OK' });
    const replay = await post(fields);
    assert.deepEqual(replay, { status: 200, body: '1|OK' });
    const tampered = await post({ ...fields, TradeAmt: '101' });
    assert.deepEqual(tampered, { status: 400, body: '0|SIGNATURE_ERROR' });
    const [storedOrder, transactions, webhooks, statusEvents, memberships] = await Promise.all([
      must('order read', db.from('payment_orders').select('status,provider_payload')
        .eq('id', order.id).single()),
      must('transaction read', db.from('payment_transactions').select('status,payload')
        .eq('payment_order_id', order.id)),
      must('webhook read', db.from('payment_webhook_events').select('payload')
        .eq('provider', 'ecpay').eq('event_key', eventKey)),
      must('status read', db.from('payment_status_events').select('to_status')
        .eq('payment_order_id', order.id)),
      must('membership read', db.from('patient_memberships').select('id')
        .eq('payment_order_id', order.id)),
    ]);
    assert.equal(storedOrder.status, success ? 'paid' : 'failed');
    assert.equal(transactions.length, 1);
    assert.equal(webhooks.length, 1);
    assert.equal(statusEvents.length, 1);
    assert.equal(memberships.length, success ? 1 : 0);
    receipt(transactions[0].payload, 'ecpay', success);
    receipt(webhooks[0].payload, 'ecpay', success);
    receipt(storedOrder.provider_payload.last_event, 'ecpay', success);
    assert.equal(storedOrder.provider_payload.fixture_marker, suffix);
    assert.equal(transactions[0].status, success ? 'accepted' : 'rejected');
    assert.equal(statusEvents[0].to_status, success ? 'paid' : 'failed');
    cases.push({ success, signedCallbackAccepted: true, duplicateDidNotMultiply: true,
      tamperedSignatureRejected: true, threeReceiptsMinimal: true,
      stateAndAuditMatched: true });
  }
  summary = { candidateCommit: 'ae7b0110d60af7b085ebf5dc81965349e15e7081',
    target: 'deployed production Web + production Supabase DEMO brand', testMerchant: true,
    actualGatewayDelivery: false, cases };
} catch (error) {
  mainError = error;
} finally {
  try { await cleanup(); }
  catch (error) { mainError = mainError ?? error; }
}
if (mainError) throw mainError;
console.log(JSON.stringify({ ...summary, fixtureResidual: 0 }));