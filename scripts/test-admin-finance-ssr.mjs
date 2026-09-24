import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const safeError = '目前無法確認操作結果';
const privateError = 'PRIVATE_FINANCE_DB_ERROR_0923';

function load(file, deps) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, Intl, Math, Object });
  return exports;
}

function fixture({ data = {}, failTable, failFrom = 1000, deny = false } = {}) {
  const calls = [];
  let clients = 0;
  const client = { from(table) {
    const call = { table, filters: [], orders: [], range: null, projection: null };
    calls.push(call);
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && call.range?.[0] === failFrom) {
          return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        }
        let rows = data[table] ?? [];
        for (const [name, column, value] of call.filters) {
          if (name === 'eq') rows = rows.filter(row => row[column] === value);
          if (name === 'neq') rows = rows.filter(row => row[column] !== value);
          if (name === 'gte') rows = rows.filter(row => row[column] >= value);
          if (name === 'lte') rows = rows.filter(row => row[column] <= value);
        }
        rows = rows.slice(call.range?.[0] ?? 0, (call.range?.[1] ?? rows.length - 1) + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        else if (key === 'order') call.orders.push(args);
        else if (key === 'range') call.range = args;
        else if (['eq', 'neq', 'gte', 'lte'].includes(key)) call.filters.push([key, ...args]);
        return query;
      };
    } });
    return query;
  } };
  const adminQuery = async value => {
    try { return await value; } catch { throw Error(safeError); }
  };
  const fetchAllSupabasePages = load('lib/supabase-pagination.ts', {
    'server-only': {}, '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
  }).fetchAllSupabasePages;
  const reportRange = load('lib/report-range.ts', {}).reportRange;
  const deps = {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ href, children }) => jsx.jsx('a', { href, children }) },
    '@/lib/supabase-pagination': { fetchAllSupabasePages },
    '@/lib/report-range': { reportRange },
    '@/lib/admin': { requireNonProvider: async () => {
      if (deny) throw Error('DENIED');
      return { clinicId: 'brand-a' };
    } },
    '@/lib/supabase-server': { createSupabaseServer: async () => { clients++; return client; } },
  };
  const page = load('app/admin/operations/finance/page.tsx', deps).default;
  return { page, calls, clients: () => clients };
}

function largeData() {
  const at = '2026-09-22T12:00:00.000Z';
  const make = (count, row) => Array.from({ length: count }, (_, index) =>
    ({ id: `row-${index}`, clinic_id: 'brand-a', ...row }));
  return {
    sales_payments: [...make(1005, { amount: 1, method: 'cash', received_at: at, sales_orders: { order_no: 'SO-A' } }),
      { clinic_id: 'brand-b', amount: 100000, method: 'cash', received_at: at }],
    sales_orders: make(1005, { total_amount: 2, paid_amount: 1, status: 'open', created_at: at }),
    purchase_orders: make(1005, { order_no: 'PO-A', status: 'ordered', created_at: at,
      inventory_suppliers: { name: '測試供應商' }, purchase_order_items: [{ quantity: 1, unit_cost: 1 }] }),
    inventory_items: make(1005, { name: '測試耗材', stock_on_hand: 1, reorder_level: 0,
      retail_price: 2, unit: '盒', active: true }),
  };
}

test('finance totals read past the first PostgREST page for all four sources', async () => {
  const f = fixture({ data: largeData() });
  const html = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({ from: '2026-09-01', to: '2026-09-30' }) }));
  assert.match(html, /NT\$1,005/);
  assert.match(html, /NT\$2,010/);
  assert.match(html, /收款減採購/);
  assert.ok(!html.includes('NT$100,000'));
  for (const table of ['sales_payments', 'sales_orders', 'purchase_orders', 'inventory_items']) {
    const calls = f.calls.filter(call => call.table === table);
    assert.equal(calls.length, 2, table);
    assert.equal(calls[0].range.join(','), '0,999');
    assert.equal(calls[1].range.join(','), '1000,1999');
    assert.ok(calls.every(call => call.filters.some(([name, column, value]) =>
      name === 'eq' && column === 'clinic_id' && value === 'brand-a')));
    assert.ok(calls.every(call => call.orders.some(([column]) => column === 'id')));
  }
});

test('finance second-page error fails closed instead of showing partial totals', async () => {
  const f = fixture({ data: largeData(), failTable: 'purchase_orders' });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({ from: '2026-09-01', to: '2026-09-30' }) }),
    error => error.message === safeError && !error.message.includes(privateError));
});

test('finance date controls reject impossible dates and normalize reversed bounds', async () => {
  const bad = fixture();
  await bad.page({ searchParams: Promise.resolve({ from: '2026-09-31', to: '2026-09-30' }) });
  const badPayment = bad.calls.find(call => call.table === 'sales_payments');
  assert.equal(badPayment.filters.find(([name, column]) => name === 'gte' && column === 'received_at')[2],
    '2026-08-31T16:00:00.000Z');

  const reverse = fixture();
  await reverse.page({ searchParams: Promise.resolve({ from: '2026-09-30', to: '2026-09-01' }) });
  const reversePayment = reverse.calls.find(call => call.table === 'sales_payments');
  assert.equal(reversePayment.filters.find(([name, column]) => name === 'gte' && column === 'received_at')[2],
    '2026-08-31T16:00:00.000Z');
  assert.equal(reversePayment.filters.find(([name, column]) => name === 'lte' && column === 'received_at')[2],
    '2026-09-30T15:59:59.999Z');
});

test('finance role denial happens before creating a database client', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }), /DENIED/);
  assert.equal(f.clients(), 0);
  assert.equal(f.calls.length, 0);
});
