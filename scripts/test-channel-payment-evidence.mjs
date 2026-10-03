import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('actions.ts', readFileSync(new URL('../app/admin/channels/actions.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const helper = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'hasAcceptedPaymentWebhook');
assert(helper);
const output = ts.transpileModule('export function factory() { ' + helper.getText(source) + ' return hasAcceptedPaymentWebhook; }', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { factory } = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
const check = factory();
const clinicId = 'qa-brand';
const payment = { provider: 'newebpay', environment: 'test' };

function fixture(variant = 'valid') {
  const calls = [];
  const data = {
    clinic_payment_settings: variant === 'changed' ? { updated_at: '2026-10-03T00:00:00Z' } : { updated_at: '2026-10-01T00:00:00Z' },
    payment_webhook_events: variant === 'unprocessed' ? [] : [{ event_key: 'signed-event' }],
    payment_transactions: variant === 'rejected' ? [] : [{ payment_order_id: 'paid-order' }],
    payment_orders: variant === 'pending' || variant === 'changed' ? [] : [{ id: 'paid-order' }],
  };
  const service = { from(table) {
    const call = { table, filters: [] };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve({ data: data[table], error: null }).then(resolve, reject);
      if (key === 'maybeSingle') return async () => ({ data: data[table], error: null });
      return (...args) => { call.filters.push([key, ...args]); return query; };
    } });
    return query;
  } };
  return { service, calls };
}

test('only current-brand accepted and processed payment proof passes', async () => {
  const { service, calls } = fixture();
  assert.equal(await check(service, clinicId, payment), true);
  assert.deepEqual(calls.map((call) => call.table), [
    'clinic_payment_settings', 'payment_webhook_events', 'payment_transactions', 'payment_orders',
  ]);
  for (const call of calls) assert(call.filters.some((filter) => filter[0] === 'eq' && filter[1] === 'clinic_id' && filter[2] === clinicId));
  assert(calls[0].filters.some((filter) => filter[0] === 'eq' && filter[1] === 'environment' && filter[2] === 'test'));
  assert(calls[1].filters.some((filter) => filter[0] === 'not' && filter[1] === 'processed_at'));
  assert(calls[2].filters.some((filter) => filter[0] === 'eq' && filter[1] === 'status' && filter[2] === 'accepted'));
  assert(calls[3].filters.some((filter) => filter[0] === 'eq' && filter[1] === 'status' && filter[2] === 'paid'));
  assert(calls[3].filters.some((filter) => filter[0] === 'gte' && filter[1] === 'created_at' && filter[2] === '2026-10-01T00:00:00Z'));
});

for (const variant of ['unprocessed', 'rejected', 'pending', 'changed']) {
  test('no false payment pass for ' + variant, async () => {
    const { service } = fixture(variant);
    assert.equal(await check(service, clinicId, payment), false);
  });
}