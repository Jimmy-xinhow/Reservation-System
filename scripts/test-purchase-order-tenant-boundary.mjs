import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('app/admin/beauty/supply/actions.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ order, item, orderError = null, itemError = null }) {
  const calls = [];
  const queries = {
    purchase_orders: { data: order, error: orderError },
    inventory_items: { data: item, error: itemError },
  };
  const service = { from(table) {
    const call = { table, filters: [], inserted: null };
    calls.push(call);
    const query = new Proxy({}, { get(_target, method) {
      if (method === 'then') return (resolve, reject) => Promise.resolve(queries[table] ?? { data: null, error: null }).then(resolve, reject);
      return (...args) => {
        if (method === 'eq') call.filters.push(args);
        if (method === 'insert') call.inserted = args[0];
        return query;
      };
    } });
    return query;
  } };
  let refreshed = 0;
  const exports = {};
  const deps = {
    '@/lib/admin-query': { adminQuery: async value => value, adminErrorMessage: () => '安全查詢失敗' },
    '@/lib/admin': { requireOperator: async () => ({ clinicId: 'brand-a' }) },
    '@/lib/supabase': { createServiceClient: () => service },
    'next/cache': { revalidatePath: () => { refreshed++; } },
    'next/navigation': { redirect: () => {} },
  };
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, String, Date, Math });
  const form = new FormData();
  for (const [key, value] of Object.entries({ order_id: 'order-a', item_id: 'item-a', quantity: '2', unit_cost: '7' })) form.set(key, value);
  return { action: () => exports.addPurchaseOrderItemAction(form), calls, refreshed: () => refreshed };
}

test('purchase order line accepts an active item in a draft order of the current brand', async () => {
  const f = fixture({ order: { id: 'order-a', status: 'draft' }, item: { id: 'item-a' } });
  await f.action();
  assert.equal(f.calls.filter(call => call.inserted).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(call => call.inserted).inserted)), {
    clinic_id: 'brand-a', purchase_order_id: 'order-a', item_id: 'item-a', quantity: 2, unit_cost: 7,
  });
  assert.equal(f.refreshed(), 4);
  for (const call of f.calls.filter(call => !call.inserted)) {
    assert.ok(call.filters.some(([key, value]) => key === 'clinic_id' && value === 'brand-a'));
  }
});

test('purchase order line rejects foreign order, foreign item, non-draft order and query failures before insert', async () => {
  for (const setup of [
    { order: null, item: { id: 'item-a' } },
    { order: { id: 'order-a', status: 'draft' }, item: null },
    { order: { id: 'order-a', status: 'received' }, item: { id: 'item-a' } },
    { order: { id: 'order-a', status: 'draft' }, item: { id: 'item-a' }, orderError: { message: 'PRIVATE_DB_ERROR' } },
  ]) {
    const f = fixture(setup);
    await assert.rejects(f.action());
    assert.equal(f.calls.some(call => call.inserted), false);
    assert.equal(f.refreshed(), 0);
  }
});
