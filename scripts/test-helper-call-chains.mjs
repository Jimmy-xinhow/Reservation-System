import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

// Audit the deployed candidate without changing its manifest or deployment.
const root = process.env.HELPER_AUDIT_ROOT ?? 'tmp/g1-release';
const canary = 'SYNTHETIC_PERSON 0900000000 private@example.invalid SYNTHETIC_SECRET';
const modules = new Set([
  'lib/payment-order-lookup.ts', 'lib/payment-webhook.ts', 'lib/rate-limit.ts',
  'lib/appointment-notifications.ts', 'lib/appointment-waitlist-notifications.ts', 'lib/registration-notifications.ts',
  'lib/line-customer-identity.ts', 'lib/line-customer-journeys.ts', 'lib/line-session.ts', 'lib/line-staff-journeys.ts', 'lib/line-audience-menu.ts',
  'lib/http.ts', 'lib/error-category.ts', 'lib/delivery-error.ts', 'lib/line-webhook-reply.ts',
]);
const scenarios = [
  ['payment lookup → status', 'payment/status', 'payment_orders', 'GET', 500],
  ['payment insert → ECPay', 'payment/ecpay/notify', 'payment_webhook_events', 'POST', 500],
  ['payment transition → Newebpay', 'payment/newebpay/notify', 'transition_verified_payment', 'POST', 500],
  ['registration queue → scoped cron', 'cron/registration', 'registration_status_events', 'POST', 500],
  ['appointment queue → scoped cron', 'cron/registration', 'appointment_status_events', 'POST', 500],
  ['waitlist queue → scoped cron', 'cron/registration', 'claim_appointment_waitlist_notifications_for_scope', 'POST', 500],
  ['shared limiter → status', 'payment/status', 'consume_api_rate_limit', 'GET', 503],
  ['customer journey → LINE', 'line/webhook', 'brand-info', 'POST', 200, 'brand'],
  ['staff journey → LINE', 'line/webhook', 'attendance_staff', 'POST', 200, 'staff_today'],
  ['session clear → LINE', 'line/webhook', 'line_customer_sessions', 'POST', 200, 'support_end'],
  ['identity lookup → LINE', 'line/webhook', 'line_customer_identities:read', 'POST', 200, 'bind_member'],
  ['identity save → LINE', 'line/webhook', 'line_customer_identities:upsert', 'POST', 200, 'bind_member'],
  ['identity patient lookup → LINE', 'line/webhook', 'patients', 'POST', 200, 'bind_member'],
  ['audience menu → LINE fallback', 'line/webhook', 'line_richmenu_aliases', 'POST', 200, 'bind_member'],
  ['event claim → LINE', 'line/webhook', 'claim_line_webhook_event', 'POST', 200, 'brand'],
  ['event finish → LINE', 'line/webhook', 'line_webhook_events', 'POST', 200, 'unknown'],
];
function harness(scenario, mode) {
  const [, route, target] = scenario;
  const logs = [], replies = [], writes = [], loaded = new Set(); let hits = 0;
  function query(table) {
    let selected = '', operation = 'read';
    const q = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve, reject) => {
      const hit = table === target || table + ':' + operation === target || target === 'brand-info' && selected === 'name, phone, address, intro';
      if (hit) { hits++; return (mode === 'rejected' ? Promise.reject(Error(canary, { cause: Error(canary) })) : Promise.resolve({ data: null, error: { message: canary, details: canary } })).then(resolve, reject); }
      let data = [];
      if (table === 'clinics') data = { id: 'brand', name: 'Fixture', slug: 'fixture' };
      if (table === 'clinic_settings') data = {};
      if (table === 'patients') data = { id: 'patient', name: 'Fixture' };
      if (table === 'line_customer_identities') data = { patient_id: 'patient', display_name: 'Fixture', profile_completed: true };
      if (table === 'claim_line_webhook_event') data = true;
      if (table === 'consume_api_rate_limit') data = [{ allowed: true, retry_after_seconds: 0 }];
      if (table === 'process_registration_cron_scope') data = { registration_ids: ['r'], appointment_ids: ['a'], waitlist_ids: ['w'] };
      if (table === 'payment_orders') data = { id: 'order', clinic_id: 'brand', amount: 100, status: 'pending', provider: 'ecpay', merchant_order_no: 'fixture01', provider_payload: {} };
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    } : (...args) => {
      if (key === 'select') selected = args[0];
      if (['insert', 'update', 'upsert'].includes(key)) { operation = key; writes.push({ table, operation, data: args[0] }); }
      return q;
    } });
    return q;
  }
  const service = { from: query, rpc: query }, cache = {};
  const overrides = {
    'lib/supabase.ts': { CLINIC_ID: 'brand', createServiceClient: () => service },
    'lib/public-brand.ts': { resolvePublicClinicId: async () => 'brand' },
    'lib/public-origin.ts': { publicRequestOrigin: () => 'https://example.invalid' },
    'lib/line-channel.ts': { getClinicLineChannelContext: async () => ({ enabled: true, liffId: null }) },
    'lib/line.ts': {
      lineCredentialsForDestination: async () => ({ channelSecret: 'fixture', accessToken: 'fixture' }),
      verifyLineSignature: () => true, getLineUserProfile: async () => ({ displayName: 'Fixture' }),
      replyMessages: async (token, messages) => replies.push({ token, messages }),
      linkRichMenuToUser: async () => { throw Error('Unexpected provider call'); },
    },
    'lib/cron-scope.ts': { readCronSelections: async () => ({ clinicId: 'brand', selections: { registration_ids: ['r'], appointment_ids: ['a'], membership_payment_ids: [], waitlist_ids: ['w'] } }) },
    'lib/payment.ts': {
      asPaymentFormFields: () => ({ MerchantTradeNo: 'fixture01', RtnCode: '1', TradeAmt: '100', TradeNo: 'trade' }),
      getPaymentSettingsByMerchant: async () => ({ clinic_id: 'brand' }), verifyEcpay: () => true,
      decryptAndVerifyNewebpay: () => ({}), parseNewebpayPaymentResult: () => ({ merchantOrderNo: 'fixture01', success: true, amount: 100, eventKey: 'event' }),
    },
  };
  function load(file) {
    if (file in overrides) return overrides[file];
    if (file in cache) return cache[file];
    loaded.add(file); const exports = {}; cache[file] = exports;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, Error, Response, Headers, URL, URLSearchParams, Buffer, console: { error: (...args) => logs.push(args) },
      process: { env: {} },
      require: name => {
        if (name === 'node:crypto') return crypto;
        if (name === 'next/server') return { NextResponse: { json: Response.json } };
        const resolved = name.startsWith('@/') ? name.slice(2) + '.ts' : name.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts' : '';
        return resolved in overrides || modules.has(resolved) ? load(resolved) : {};
      },
    });
    // Rendering is irrelevant to testing the actual identity/menu data path.
    if (file === 'lib/line-customer-journeys.ts') exports.lineNativeMemberLinkedMessage = () => ({ type: 'text', text: 'Fixture member linked' });
    return exports;
  }
  const api = load('app/api/' + route + '/route.ts');
  const body = { destination: 'fixture', events: [{ type: 'postback', webhookEventId: 'event', replyToken: 'reply', source: { userId: 'line-user' }, postback: { data: 'action=' + (scenario[5] ?? 'unknown') } }] };
  return { loaded, logs, replies, writes, hits: () => hits, run: () => api[scenario[3]]({
    nextUrl: new URL('https://example.invalid/api?order=fixture01&provider=ecpay'),
    headers: new Headers({ 'x-line-signature': 'fixture' }), text: async () => JSON.stringify(body), formData: async () => new FormData(),
  }) };
}
for (const scenario of scenarios) for (const mode of ['returned', 'rejected']) test(scenario[0] + ': ' + mode, async () => {
  const h = harness(scenario, mode), response = await h.run(), body = await response.text();
  assert.ok(h.hits() >= 1, 'injected failure must reach actual helper');
  assert.equal(response.status, scenario[4]);
  const outputs = JSON.stringify([body, h.logs, h.replies, h.writes]);
  for (const token of canary.split(' ')) assert.ok(!outputs.includes(token), token);
  if (scenario[1] === 'line/webhook' && !['claim_line_webhook_event', 'line_webhook_events'].includes(scenario[2])) {
    const status = h.writes.find(x => x.table === 'line_webhook_events')?.data.status;
    assert.equal(status, scenario[2] === 'line_richmenu_aliases' ? 'processed' : 'failed');
  }
});
