import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const safeError = '目前無法確認操作結果';
const privateError = 'PRIVATE_STOCK_DB_ERROR_0923';
const fieldList = 'id, sku, name, unit, stock_on_hand, reorder_level, retail_price, active';

function load(file, deps) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, Intl, Math, Object, Array });
  return exports;
}

function fixture(file, { failSecondPage = false, failMovement = false, deny = false } = {}) {
  const calls = [];
  const items = Array.from({ length: 1001 }, (_, index) => ({
    id: `item-${index}`, clinic_id: 'brand-a', sku: `QA-STOCK-${String(index).padStart(4, '0')}`,
    name: `驗收庫存 ${String(index).padStart(4, '0')}`, unit: '件', stock_on_hand: 1,
    reorder_level: 0, retail_price: 2, active: true,
  }));
  items.push({ ...items[0], id: 'foreign', clinic_id: 'brand-b', retail_price: 999999 });
  const movements = Array.from({ length: 31 }, (_, index) => ({
    id: `movement-${String(index).padStart(4, '0')}`, clinic_id: 'brand-a', item_id: 'item-0',
    kind: index === 30 ? 'stocktake' : 'stock_in', quantity: 1, stock_after: index + 1,
    note: `驗收異動 ${String(index).padStart(4, '0')}`, created_at: '2026-09-23T10:00:00Z',
    inventory_items: { clinic_id: 'brand-a', name: '驗收庫存 0000', unit: '件' },
  }));
  movements[1].item_id = 'foreign';
  movements[1].inventory_items = { clinic_id: 'brand-b', name: 'OTHER_BRAND_ITEM', unit: '件' };
  movements.push({ ...movements[0], id: 'foreign-movement', clinic_id: 'brand-b',
    note: 'OTHER_BRAND_MOVEMENT', inventory_items: { clinic_id: 'brand-b', name: 'OTHER_BRAND_ITEM', unit: '件' } });
  const db = { from(table) {
    const call = { table, projection: null, filters: [], range: null, orders: [], limit: null };
    calls.push(call);
    let query;
    query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === 'inventory_items' && failSecondPage && call.range?.[0] === 1000) {
          return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        }
        if (table === 'inventory_movements' && failMovement) {
          return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        }
        let rows = table === 'inventory_items' ? items : table === 'inventory_movements' ? movements : [];
        for (const [method, column, value] of call.filters) {
          if (method === 'eq') rows = rows.filter(row => row[column] === value);
        }
        for (const [column, options] of [...call.orders].reverse()) {
          rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (options?.ascending === false ? -1 : 1));
        }
        rows = rows.slice(call.range?.[0] ?? 0, (call.range?.[1] ?? (call.limit ?? 1000) - 1) + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        else if (key === 'eq') call.filters.push([key, ...args]);
        else if (key === 'range') call.range = args;
        else if (key === 'order') call.orders.push(args);
        else if (key === 'limit') call.limit = args[0];
        return query;
      };
    } });
    return query;
  } };
  const adminQuery = async value => { try { return await value; } catch { throw Error(safeError); } };
  const fetchAllSupabasePages = load('lib/supabase-pagination.ts', {
    'server-only': {}, '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
  }).fetchAllSupabasePages;
  const member = { clinicId: 'brand-a', supabase: db };
  const deps = {
    'react/jsx-runtime': jsx,
    '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
    '@/lib/supabase-pagination': { fetchAllSupabasePages },
    'next/link': { default: ({ href, children }) => jsx.jsx('a', { href, children }) },
    '@/lib/admin': { requireAdmin: async () => { if (deny) throw Error('DENIED'); return member; },
      requireNonProvider: async () => { if (deny) throw Error('DENIED'); return member; } },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    './actions': { createProductAction() {}, recordProductMovementAction() {}, toggleProductAction() {}, updateProductAction() {} },
    '@/lib/slots': { formatDateTime: value => value },
    '@/lib/supabase': { createServiceClient: () => db },
    '../../beauty/actions': { createInventoryItemAction() {}, recordInventoryMovementAction() {} },
  };
  return { page: load(file, deps).default, calls };
}

for (const [label, file, expected] of [
  ['products', 'app/admin/products/page.tsx', '商品摘要'],
  ['inventory', 'app/admin/operations/inventory/page.tsx', '啟用品項'],
]) {
  test(`${label} summary includes item 1001 and last page can operate it`, async () => {
    const f = fixture(file);
    const first = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({ page: '1' }) }));
    const last = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({ page: '21' }) }));
    assert.ok(first.includes(expected));
    assert.ok(first.includes('1001'));
    assert.ok(!first.includes('驗收庫存 1000'));
    assert.ok(last.includes('驗收庫存 1000'));
    assert.ok(last.includes('21／21'));
    assert.ok(!last.includes('999,999'));
    const itemCalls = f.calls.filter(call => call.table === 'inventory_items');
    assert.equal(itemCalls.length, 4);
    assert.ok(itemCalls.every(call => call.projection === fieldList));
    assert.ok(itemCalls.every(call => call.filters.some(([method, column, value]) =>
      method === 'eq' && column === 'clinic_id' && value === 'brand-a')));
    assert.ok(itemCalls.every(call => call.orders.some(([column]) => column === 'id')));
  });

  test(`${label} second inventory page failure does not render a partial list`, async () => {
    const f = fixture(file, { failSecondPage: true });
    await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
      error => error.message === safeError && !error.message.includes(privateError));
  });

  test(`${label} role denial happens before inventory lookup`, async () => {
    const f = fixture(file, { deny: true });
    await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }), /DENIED/);
    assert.equal(f.calls.length, 0);
  });

  test(`${label} recent movement shows newest 30 scoped rows with stable ties`, async () => {
    const f = fixture(file);
    const html = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({ page: '1' }) }));
    assert.ok(html.includes('最近庫存異動'));
    assert.ok(html.includes('驗收異動 0030'));
    assert.ok(!html.includes('驗收異動 0000'));
    assert.ok(!html.includes('OTHER_BRAND_MOVEMENT'));
    assert.ok(!html.includes('OTHER_BRAND_ITEM'));
    assert.ok(html.includes('驗收異動 0001'));
    assert.ok(html.includes('盤點調整'));
    const calls = f.calls.filter(call => call.table === 'inventory_movements');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].limit, 30);
    if (label === 'inventory') assert.ok(calls[0].projection.includes('inventory_items!inventory_movements_clinic_item_fkey(clinic_id, name, unit)'));
    assert.deepEqual(calls[0].orders.map(([column, options]) => [column, options.ascending]),
      [['created_at', false], ['id', false]]);
    assert.ok(calls[0].filters.some(([method, column, value]) =>
      method === 'eq' && column === 'clinic_id' && value === 'brand-a'));
  });

  test(`${label} movement read failure does not render an empty history`, async () => {
    const f = fixture(file, { failMovement: true });
    await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
      error => error.message === safeError && !error.message.includes(privateError));
  });
}
