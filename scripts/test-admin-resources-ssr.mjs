import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fixture-brand';
const privateError = 'PRIVATE_RESOURCE_DB_ERROR';
const foreignName = 'FOREIGN_BRAND_SECRET_NAME';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

function fixture({ failTable = '', deny = false } = {}) {
  const calls = [];
  const props = [];
  let factoryCalls = 0;
  const resources = Array.from({ length: 1001 }, (_, index) => ({ id: `resource-${String(index).padStart(4, '0')}`, clinic_id: clinicId, name: `資源 ${index}`, kind: 'room', capacity: 2, active: true }));
  const services = Array.from({ length: 1001 }, (_, index) => ({ id: `service-${String(index).padStart(4, '0')}`, clinic_id: clinicId, name: `服務 ${index}`, active: true }));
  const assignments = Array.from({ length: 1001 }, (_, index) => ({ id: `assignment-${String(index).padStart(4, '0')}`, clinic_id: clinicId, service_id: services[index].id, resource_id: resources[index].id, quantity: 1, created_at: '2026-09-23T00:00:00Z', services: { clinic_id: clinicId, name: services[index].name }, service_resources: { clinic_id: clinicId, name: resources[index].name } }));
  assignments.push({ id: 'assignment-crossbrand', clinic_id: clinicId, service_id: 'other-service', resource_id: 'other-resource', quantity: 1, created_at: '2026-09-23T00:00:00Z', services: { clinic_id: 'other-brand', name: foreignName }, service_resources: { clinic_id: 'other-brand', name: foreignName } });
  const rows = { service_resources: resources, services, service_resource_assignments: assignments };
  const client = { from(table) {
    const call = { table, projection: '', filters: [], orders: [], range: null };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => {
        if (table === failTable && call.range?.[0] === 1000) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, reject);
        let data = rows[table] ?? [];
        for (const [method, column, value] of call.filters) if (method === 'eq') data = data.filter(row => row[column] === value);
        const [from, to] = call.range ?? [0, 999];
        return Promise.resolve({ data: data.slice(from, to + 1), error: null }).then(resolve, reject);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (key === 'eq') call.filters.push([key, ...args]);
        if (key === 'order') call.orders.push(args[0]);
        if (key === 'range') call.range = args;
        return query;
      };
    } });
    return query;
  } };
  const pagination = load('lib/supabase-pagination.ts', {
    'server-only': {},
    '@/lib/admin-query': { adminQuery: async promise => await promise, adminErrorMessage: () => '目前無法確認操作結果' },
  });
  const page = load('app/admin/resources/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase-pagination': pagination,
    '@/lib/admin': { requireAdmin: async () => { if (deny) throw Error('DENIED'); return { clinicId }; } },
    '@/lib/supabase': { createServiceClient: () => { factoryCalls++; return client; } },
    './ResourceManager': { default: componentProps => { props.push(componentProps); return jsx.jsx('div', { children: 'ResourceManager' }); } },
    './actions': { assignResourceAction: () => {}, createResourceAction: () => {}, removeAssignmentAction: () => {}, toggleResourceAction: () => {} },
    '@/components/admin/ManagementTabs': { ServiceSetupTabs: () => null },
  });
  return { page, calls, props, factoryCalls: () => factoryCalls };
}

test('resources page reads row 1001 in all sources and hides cross-brand relation names', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page.default());
  assert.match(html, /啟用資源/);
  assert.match(html, /1001/);
  assert.match(html, /2002/);
  assert.ok(!html.includes(foreignName));
  const props = f.props[0];
  assert.equal(props.resources.length, 1001);
  assert.equal(props.services.length, 1001);
  assert.equal(props.assignments.length, 1002);
  assert.equal(props.resources.at(-1).id, 'resource-1000');
  assert.equal(props.services.at(-1).id, 'service-1000');
  assert.equal(props.assignments.find(row => row.id === 'assignment-crossbrand').service_name, '未知服務');
  assert.equal(props.assignments.find(row => row.id === 'assignment-crossbrand').resource_name, '未知資源');
  assert.ok(!JSON.stringify(props).includes(foreignName));
  for (const table of Object.keys({ service_resources: 1, services: 1, service_resource_assignments: 1 })) {
    const calls = f.calls.filter(call => call.table === table);
    assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999]]);
    assert.ok(calls.every(call => call.filters.some(([method, column, value]) => method === 'eq' && column === 'clinic_id' && value === clinicId)));
    assert.ok(calls.every(call => call.orders.includes('id')));
  }
  const projection = f.calls.find(call => call.table === 'service_resource_assignments').projection;
  assert.match(projection, /services!service_resource_assignments_service_id_fkey\(clinic_id, name\)/);
  assert.match(projection, /service_resources!service_resource_assignments_resource_id_fkey\(clinic_id, name\)/);
});

for (const table of ['service_resources', 'services', 'service_resource_assignments']) {
  test(`resources page fails closed when ${table} page two fails`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(() => f.page.default(), error => {
      assert.match(error.message, /目前無法確認操作結果/);
      assert.ok(!error.message.includes(privateError));
      return true;
    });
    assert.equal(f.props.length, 0);
  });
}

test('resources page rejects unauthorized role before service client creation', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page.default(), /DENIED/);
  assert.equal(f.factoryCalls(), 0);
  assert.equal(f.calls.length, 0);
});
