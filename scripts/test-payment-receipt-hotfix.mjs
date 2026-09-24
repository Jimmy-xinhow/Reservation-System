import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/payment-webhook.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let currentOrder;
const exports = {};
vm.runInNewContext(compiled, {
  exports,
  require(name) {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return { createHash };
    if (name === './payment-order-lookup') return {
      findPaymentOrderByMerchant: async () => currentOrder,
      mergePaymentProviderEvent: (previous, merchant, receipt) => ({
        ...previous, last_merchant_order_no: merchant, last_event: receipt,
      }),
    };
    throw new Error('Unexpected import: ' + name);
  },
});

function database(duplicate = false) {
  const inserted = new Map();
  const updated = new Map();
  return {
    inserted,
    updated,
    from(table) {
      return {
        insert: async value => {
          inserted.set(table, value);
          return { error: table === 'payment_webhook_events' && duplicate ? { code: '23505' } : null };
        },
        update: value => {
          updated.set(table, value);
          const query = {
            eq: () => query,
            in: () => query,
            select: () => query,
            maybeSingle: async () => ({ data: { id: currentOrder.id }, error: null }),
            then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
          };
          return query;
        },
      };
    },
  };
}

function order(provider, status = 'pending') {
  return {
    id: 'synthetic-order', clinic_id: 'synthetic-brand', registration_id: null,
    appointment_id: null, membership_plan_id: null, patient_id: null,
    amount: 100, status, provider, merchant_order_no: 'SYNTH-100',
    provider_payload: { other_key: 'preserved' },
  };
}
function event(provider, success) {
  return {
    provider, clinicId: 'synthetic-brand', merchantOrderNo: 'SYNTH-100',
    providerTransactionNo: 'synthetic-tx', eventKey: 'synthetic-event',
    success, amount: 100,
    payload: { BuyerName: 'SYNTHETIC PRIVATE', Phone: '0900000000',
      CheckMacValue: 'synthetic-signature', Status: success ? 'SUCCESS' : 'FAIL' },
  };
}
function verifyReceipt(value, sourceEvent) {
  const receipt = JSON.parse(JSON.stringify(value));
  assert.deepEqual(Object.keys(receipt).sort(), [
    'amount', 'event_key', 'merchant_order_no', 'payload_sha256',
    'provider', 'provider_transaction_no', 'receipt_version', 'success',
  ]);
  assert.equal(receipt.receipt_version, 1);
  assert.equal(receipt.provider, sourceEvent.provider);
  assert.equal(receipt.success, sourceEvent.success);
  assert.equal(receipt.payload_sha256,
    createHash('sha256').update(JSON.stringify(sourceEvent.payload)).digest('hex'));
  assert.equal(JSON.stringify(receipt).includes('SYNTHETIC PRIVATE'), false);
  assert.equal(JSON.stringify(receipt).includes('synthetic-signature'), false);
  return receipt;
}

for (const [provider, success] of [['ecpay', true], ['newebpay', false]]) {
  currentOrder = order(provider);
  const db = database();
  const callback = event(provider, success);
  const result = await exports.processPaymentWebhook(db, callback);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),
    { duplicate: false, accepted: success, changed: true });
  const webhook = verifyReceipt(db.inserted.get('payment_webhook_events').payload, callback);
  const transaction = verifyReceipt(db.inserted.get('payment_transactions').payload, callback);
  const storedOrder = JSON.parse(JSON.stringify(db.updated.get('payment_orders').provider_payload));
  assert.deepEqual(transaction, webhook);
  assert.deepEqual(storedOrder.last_event, webhook);
  assert.equal(storedOrder.other_key, 'preserved');
  assert.equal(storedOrder.last_merchant_order_no, 'SYNTH-100');
}

currentOrder = order('ecpay', 'paid');
const duplicateDb = database(true);
const duplicateResult = await exports.processPaymentWebhook(duplicateDb, event('ecpay', true));
assert.deepEqual(JSON.parse(JSON.stringify(duplicateResult)),
  { duplicate: true, accepted: true, changed: false });
verifyReceipt(duplicateDb.inserted.get('payment_webhook_events').payload, event('ecpay', true));
assert.equal(duplicateDb.inserted.has('payment_transactions'), false);

currentOrder = order('ecpay');
const mismatchDb = database();
await assert.rejects(() => exports.processPaymentWebhook(mismatchDb,
  { ...event('ecpay', true), amount: 101 }));
assert.equal(mismatchDb.inserted.size, 0);

console.log(JSON.stringify({
  isolatedProductionSource: true,
  providerFlows: 2,
  duplicateFlow: true,
  amountMismatchWrites: 0,
  eightFieldReceiptInThreeStores: true,
  rawCustomerAndSignatureExcluded: true,
  unrelatedOrderKeysPreserved: true,
}));