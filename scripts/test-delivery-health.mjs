import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeliveryHealth, deliveryChecks } from './check-delivery-health.mjs';
const clinic = '11111111-1111-4111-8111-111111111111';
function dbMock(result = { count: 0, error: null }) {
  const calls = [];
  return { calls, from: table => {
    const call = { table, filters: [] }; calls.push(call);
    const q = { select: (columns, opts) => { call.select = [columns, opts]; return q; },
      in: (key, values) => { call.filters.push([key, values]); return q; },
      or: filter => { call.or = filter; return q; },
      then: (resolve, reject) => Promise.resolve().then(() => typeof result === 'function' ? result(table) : result).then(resolve, reject) };
    return q;
  } };
}
test('delivery health is count-only and every query stays inside explicit brands', async () => {
  const db = dbMock(), r = await checkDeliveryHealth(db, [clinic], 15, Date.parse('2026-09-21T00:00:00Z'));
  assert.equal(r.status, 'healthy'); assert.equal(db.calls.length, deliveryChecks.length);
  for (const call of db.calls) {
    assert.deepEqual(call.select, ['id', { count: 'exact', head: true }]);
    assert.deepEqual(call.filters[0], ['clinic_id', [clinic]]);
    assert.match(call.or, /2026-09-20T23:45:00.000Z/); assert.match(call.or, /is.null/);
    if (call.table === 'scheduled_followups') assert.deepEqual(call.filters.at(-1), ['channel', ['line', 'email']]);
  }
  assert(!JSON.stringify(r).includes(clinic));
});
test('delivery health alerts on outstanding work despite successful cron', async () => {
  const r = await checkDeliveryHealth(dbMock({ count: 1 }), [clinic], 15);
  assert.equal(r.status, 'attention_required'); assert.equal(r.outstanding, 8); assert.equal(r.ok, false);
});
for (const result of [{ count: null }, { count: -1 }, { count: 0, error: { message: 'secret' } }, () => { throw Error('secret'); }]) {
  test('delivery health fails closed on unavailable count without exposing provider errors', async () => {
    const r = await checkDeliveryHealth(dbMock(result), [clinic], 15);
    assert.equal(r.status, 'query_failed'); assert.equal(r.ok, false); assert(!JSON.stringify(r).includes('secret'));
  });
}
for (const [ids, minutes] of [[[], 15], [[clinic, clinic.toUpperCase()], 15], [['invalid'], 15], [[clinic], 0], [[clinic], Infinity]]) {
  test('delivery health rejects invalid scope before accessing DB', async () => {
    const db = dbMock(); assert.equal((await checkDeliveryHealth(db, ids, minutes)).status, 'invalid_scope'); assert.equal(db.calls.length, 0);
  });
}
