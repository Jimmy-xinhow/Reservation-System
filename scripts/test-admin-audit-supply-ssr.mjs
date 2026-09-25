import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const privateError = 'PRIVATE_UPSTREAM_ERROR_0923';
const safeError = '目前無法確認操作結果';
const otherBrand = 'OTHER_BRAND_CANARY_0923';

function load(file, deps) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Error, Promise, Number, Date, Map, Intl });
  return exports.default;
}

function fixture({ data = {}, failedTable, rejectTable, failSecondPageTable, deny = false } = {}) {
  const queries = [];
  let serverClients = 0;
  const supabase = { from(table) {
    const call = { table, projection: null, clinicId: null, limit: null, order: null, range: null, filters: [] };
    queries.push(call);
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === rejectTable) return Promise.reject(Error(privateError)).then(resolve, reject);
        if (table === failSecondPageTable && call.range?.[0] === 1000) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        const source = data[table] ?? [];
        let rows = Array.isArray(source) && call.clinicId
          ? source.filter(row => row.clinic_id === undefined || row.clinic_id === call.clinicId)
          : source;
        for (const [column, value] of call.filters) rows = rows.filter(row => row[column] === value);
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
        return Promise.resolve({ data: rows, error: table === failedTable ? { message: privateError } : null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (key === 'eq' && args[0] === 'clinic_id') call.clinicId = args[1];
        else if (key === 'eq') call.filters.push(args);
        if (key === 'limit') call.limit = args[0];
        if (key === 'order') call.order = args;
        if (key === 'range') call.range = args;
        return query;
      };
    } });
    return query;
  } };
  const deps = {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ href, children }) => jsx.jsx('a', { href, children }) },
    '@/lib/admin-query': { adminQuery: async value => {
      try { return await value; } catch { throw Error(safeError); }
    }, adminErrorMessage: () => safeError },
    '@/lib/supabase-pagination': { fetchAllSupabasePages: async fetchPage => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await fetchPage(from, from + 999);
        if (error) throw Error(safeError);
        rows.push(...(page ?? []));
        if (!page || page.length < 1000) return rows;
      }
    } },
    '@/lib/admin': {
      requireAdmin: async () => { if (deny) throw Error('DENIED'); return { supabase, clinicId: 'brand-a' }; },
      requireNonProvider: async () => { if (deny) throw Error('DENIED'); return { clinicId: 'brand-a' }; },
    },
    '@/lib/supabase-server': { createSupabaseServer: async () => { serverClients++; return supabase; } },
    '@/components/TechnicalDetails': { TechnicalDetails: () => null },
    '@/lib/admin-display': { auditSourceLabel: value => value, auditStatusLabel: value => value ?? 'none' },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    './actions': new Proxy({}, { get: () => () => {} }),
  };
  return { deps, queries, serverClients: () => serverClients };
}

function auditEvent(table, index, time, clinicId = 'brand-a') {
  const key = table === 'appointment_status_events' ? 'appointment_id'
    : table === 'registration_status_events' ? 'registration_id' : 'payment_order_id';
  return { id: `${table}-${index}`, clinic_id: clinicId, created_at: time,
    from_status: 'booked', to_status: 'confirmed', source: 'admin', actor_id: null,
    note: '已聯絡顧客', [key]: `record-${index}` };
}

test('brand audit merges latest 200, preserves brand scope and displays authorized notes', async () => {
  const appointments = Array.from({ length: 150 }, (_, i) => auditEvent('appointment_status_events', i,
    new Date(Date.parse('2026-09-23T00:00:00Z') - i * 1000).toISOString()));
  const payments = Array.from({ length: 80 }, (_, i) => auditEvent('payment_status_events', i,
    new Date(Date.parse('2026-09-22T00:00:00Z') - i * 1000).toISOString()));
  appointments.push({ ...auditEvent('appointment_status_events', 999, '2026-09-24T00:00:00Z', 'brand-b'), note: otherBrand });
  const f = fixture({ data: { appointment_status_events: appointments, payment_status_events: payments } });
  const page = load('app/admin/audit/page.tsx', f.deps);
  const html = renderToStaticMarkup(await page());
  assert.equal((html.match(/<tr\b/g) ?? []).length, 201);
  assert.match(html, /已聯絡顧客/);
  assert.ok(!html.includes(otherBrand));
  assert.equal(f.queries.length, 3);
  for (const query of f.queries) {
    assert.equal(query.clinicId, 'brand-a');
    assert.equal(query.limit, 200);
    assert.equal(query.order[0], 'created_at');
    assert.equal(query.order[1].ascending, false);
  }
});

test('brand audit returned and rejected query errors fail closed', async () => {
  for (const failure of [
    { failedTable: 'registration_status_events' },
    { rejectTable: 'payment_status_events' },
  ]) {
    const f = fixture(failure);
    const page = load('app/admin/audit/page.tsx', f.deps);
    await assert.rejects(() => page(), error => error.message === safeError);
  }
});

test('brand audit checks role before querying', async () => {
  const f = fixture({ deny: true });
  const page = load('app/admin/audit/page.tsx', f.deps);
  await assert.rejects(() => page(), /DENIED/);
  assert.equal(f.queries.length, 0);
});

function supplyData() {
  return {
    inventory_suppliers: [{ clinic_id: 'brand-a', id: 'supplier-a', name: '測試供應商', phone: 'PRIVATE_PHONE_0923', email: 'PRIVATE_EMAIL_0923' }],
    inventory_items: [{ clinic_id: 'brand-a', id: 'item-a', name: '測試耗材', sku: 'SKU-A', unit: '盒', stock_on_hand: 5, retail_price: 100 }],
    purchase_orders: [{ clinic_id: 'brand-a', id: 'order-a', order_no: 'PO-A', status: 'draft', expected_at: null,
      note: 'PRIVATE_ORDER_NOTE_0923', inventory_suppliers: { name: '測試供應商' },
      purchase_order_items: [{ id: 'line-a', quantity: 2, unit_cost: 10, inventory_items: { name: '測試耗材', unit: '盒' } }] }],
    inventory_stocktakes: [{ clinic_id: 'brand-a', id: 'stocktake-a', stocktake_no: 'ST-A', note: '盤點完成',
      completed_at: '2026-09-23T00:00:00Z', inventory_stocktake_items: [{ variance: 1, inventory_items: { name: '測試耗材' } }] }],
  };
}

test('supply page projects only fields needed by rendered purchase and stocktake views', async () => {
  const f = fixture({ data: supplyData() });
  const page = load('app/admin/beauty/supply/page.tsx', f.deps);
  const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ order_id: 'order-a' }) }));
  assert.match(html, /測試供應商/);
  assert.match(html, /PO-A/);
  assert.match(html, /ST-A/);
  assert.match(html, /盤點完成/);
  assert.ok(!html.includes('PRIVATE_PHONE_0923'));
  assert.ok(!html.includes('PRIVATE_EMAIL_0923'));
  assert.equal(f.queries.length, 4);
  for (const query of f.queries) assert.equal(query.clinicId, 'brand-a');
  assert.equal(f.queries.find(query => query.table === 'inventory_suppliers').projection, 'id,name');
  assert.equal(f.queries.find(query => query.table === 'inventory_items').projection, 'id,name,sku,unit,stock_on_hand');
  assert.ok(!f.queries.find(query => query.table === 'purchase_orders').projection.includes('note'));
});

test('supply page query errors fail closed before purchase forms render', async () => {
  for (const table of ['inventory_suppliers', 'inventory_items', 'purchase_orders', 'inventory_stocktakes']) {
    const f = fixture({ data: supplyData(), failedTable: table });
    const page = load('app/admin/beauty/supply/page.tsx', f.deps);
    await assert.rejects(() => page({ searchParams: Promise.resolve({}) }), error => error.message === safeError);
  }
});

test('supply page blocks provider before creating server client', async () => {
  const f = fixture({ deny: true });
  const page = load('app/admin/beauty/supply/page.tsx', f.deps);
  await assert.rejects(() => page({ searchParams: Promise.resolve({}) }), /DENIED/);
  assert.equal(f.serverClients(), 0);
  assert.equal(f.queries.length, 0);
});

test('supply can purchase and stocktake the 1001st item on its own page', async () => {
  const items = Array.from({ length: 1001 }, (_, index) => ({
    id: `item-${index}`, clinic_id: 'brand-a', active: true,
    name: `驗收耗材 ${String(index).padStart(4, '0')}`, sku: `S-${index}`, unit: '盒', stock_on_hand: 1,
  }));
  items.push({ ...items[0], id: 'foreign-item', clinic_id: 'brand-b', name: otherBrand });
  const f = fixture({ data: { ...supplyData(), inventory_items: items } });
  const page = load('app/admin/beauty/supply/page.tsx', f.deps);
  const first = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ page: '1' }) }));
  const last = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ page: '21' }) }));
  assert.match(first, /共 1001 項/);
  assert.ok(!first.includes('name="count:item-1000"'));
  assert.ok(last.includes('name="count:item-1000"'));
  assert.match(last, /第 21／21 頁/);
  assert.ok(!last.includes(otherBrand));
  const calls = f.queries.filter(query => query.table === 'inventory_items');
  assert.deepEqual(calls.map(query => query.range?.[0]), [0, 1000, 0, 1000]);
  assert.ok(calls.every(query => query.clinicId === 'brand-a' && query.order?.[0] === 'id'));
});

test('supply second inventory page error does not show incomplete stocktake', async () => {
  const items = Array.from({ length: 1001 }, (_, index) => ({
    id: `item-${index}`, clinic_id: 'brand-a', active: true, name: `項目 ${index}`,
    sku: `S-${index}`, unit: '盒', stock_on_hand: 1,
  }));
  const f = fixture({ data: { ...supplyData(), inventory_items: items }, failSecondPageTable: 'inventory_items' });
  const page = load('app/admin/beauty/supply/page.tsx', f.deps);
  await assert.rejects(() => page({ searchParams: Promise.resolve({ page: '21' }) }),
    error => error.message === safeError && !error.message.includes(privateError));
});
