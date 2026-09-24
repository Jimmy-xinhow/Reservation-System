import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const safeError = '目前無法確認操作結果';
const privateError = 'PRIVATE_CHECKOUT_QUERY_ERROR';

function load(file, deps) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, Intl, Math, Object, Array });
  return exports;
}

function fixture({ failTable, failFrom = 1000, deny = false } = {}) {
  const calls = [];
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const orders = Array.from({ length: 101 }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
    clinic_id: 'brand-a', order_no: `SO-${index}`, status: index === 0 ? 'partially_paid' : 'open',
    total_amount: 10, paid_amount: index === 0 ? 7 : 0, subtotal: 10,
    discount_amount: 0, created_at: yesterday, patient_id: null, appointment_id: null,
    registration_id: null, patients: null, sales_order_items: [], sales_payments: [],
  }));
  orders.push({ ...orders[0], id: 'other-brand', clinic_id: 'brand-b', total_amount: 999999 });
  const products = Array.from({ length: 1001 }, (_, index) => ({
    id: `item-${index}`, clinic_id: 'brand-a', active: true,
    name: `商品 ${String(index).padStart(4, '0')}`, retail_price: 2, stock_on_hand: 1, unit: '件',
  }));
  products.push({ ...products[0], id: 'other-product', clinic_id: 'brand-b', name: '外品牌機密商品' });
  const data = {
    sales_orders: orders,
    sales_payments: [
      { id: 'payment-today', clinic_id: 'brand-a', received_at: now, amount: 7 },
      { id: 'payment-yesterday', clinic_id: 'brand-a', received_at: yesterday, amount: 20 },
      { id: 'payment-foreign', clinic_id: 'brand-b', received_at: now, amount: 999999 },
    ],
    inventory_items: products, services: [], membership_plans: [],
  };
  const db = { from(table) {
    const call = { table, filters: [], orders: [], range: null, maybeSingle: false };
    calls.push(call);
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && call.range?.[0] === failFrom) {
          return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        }
        let rows = data[table] ?? [];
        for (const [method, column, value] of call.filters) {
          if (method === 'eq') rows = rows.filter(row => row[column] === value);
          if (method === 'gte') rows = rows.filter(row => row[column] >= value);
          if (method === 'lte') rows = rows.filter(row => row[column] <= value);
        }
        rows = [...rows].sort((a, b) => {
          for (const [column, options] of call.orders) {
            const difference = String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
            if (difference !== 0) return options?.ascending === false ? -difference : difference;
          }
          return 0;
        });
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
        return Promise.resolve({ data: call.maybeSingle ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'eq' || key === 'gte' || key === 'lte') call.filters.push([key, ...args]);
        if (key === 'order') call.orders.push(args);
        if (key === 'range') call.range = args;
        if (key === 'maybeSingle') call.maybeSingle = true;
        return query;
      };
    } });
    return query;
  } };
  const adminQuery = async value => { try { return await value; } catch { throw Error(safeError); } };
  const fetchAllSupabasePages = load('lib/supabase-pagination.ts', {
    'server-only': {}, '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
  }).fetchAllSupabasePages;
  const reportRange = load('lib/report-range.ts', {}).reportRange;
  const deps = {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ href, children }) => jsx.jsx('a', { href, children }) },
    '@/lib/admin-query': { adminQuery, adminErrorMessage: () => safeError },
    '@/lib/supabase-pagination': { fetchAllSupabasePages },
    '@/lib/report-range': { reportRange },
    '@/lib/admin': {
      requireNonProvider: async () => {
        if (deny) throw Error('DENIED');
        return { clinicId: 'brand-a', supabase: db };
      },
      hasBrandPermission: () => true,
    },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    './actions': { recordSalesPaymentAction() {}, updateSalesOrderItemAction() {} },
    './AddSalesItemPanel': { AddSalesItemPanel: ({ products: catalog }) => jsx.jsx('span', { children: `商品選單 ${catalog.length} ${catalog.at(-1)?.name}` }) },
    './new/SalesOrderEditor': { default: () => null },
  };
  return { page: load('app/admin/checkout/page.tsx', deps).default, calls, orders };
}

test('checkout totals use all orders and Taipei payment time, with older orders reachable', async () => {
  const f = fixture();
  const first = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({ page: '1', order_id: f.orders[0].id }) }));
  assert.match(first, /銷售單<\/span><strong[^>]*>101<\/strong>/);
  assert.match(first, /今日已收<\/span><strong[^>]*>NT\$7<\/strong>/);
  assert.match(first, /目前未收<\/span><strong[^>]*>NT\$1,003<\/strong>/);
  assert.match(first, /商品選單 1001 商品 1000/);
  assert.match(first, /第 1／3 頁/);
  assert.ok(!first.includes('外品牌機密商品'));
  assert.ok(!first.includes('999,999'));
  const last = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({ page: '3' }) }));
  assert.match(last, /第 3／3 頁/);
  assert.match(last, /SO-0/);
  assert.ok(f.calls.filter(call => call.table === 'sales_orders').every(call =>
    call.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === 'brand-a')));
  assert.ok(f.calls.filter(call => call.table === 'inventory_items').every(call =>
    call.orders.some(([column]) => column === 'id')));
});

test('checkout second product page error fails closed', async () => {
  const f = fixture({ failTable: 'inventory_items' });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }),
    error => error.message === safeError && !error.message.includes(privateError));
});

test('checkout role denial precedes all tenant queries', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page({ searchParams: Promise.resolve({}) }), /DENIED/);
  assert.equal(f.calls.length, 0);
});
