import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const clinicId = 'checkout-brand';
const canary = 'SECRET_PROVIDER_ERROR';
function load(deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/api/admin/checkout/sources/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { if (name in deps) return deps[name]; throw Error(`Unexpected dependency ${name}`); }, Promise, Number, Array, Intl, console });
  return exports.GET;
}
function fixture({ member = true, allowed = true, failTable = null } = {}) {
  const calls = [];
  const tables = {
    patients: [
      ...Array.from({ length: 501 }, (_, i) => ({ id: `patient-${i}`, clinic_id: clinicId, active: true, name: i === 500 ? 'Z 顧客末筆' : `A 顧客 ${String(i).padStart(3, '0')}`, phone: `09${String(i).padStart(8, '0')}` })),
      { id: 'foreign-patient', clinic_id: 'foreign-brand', active: true, name: 'Z 顧客末筆', phone: '0999999999' },
      { id: 'inactive-patient', clinic_id: clinicId, active: false, name: 'Z 顧客末筆', phone: '0999999998' },
    ],
    appointments: [
      ...Array.from({ length: 21 }, (_, i) => ({ id: `appointment-${i}`, clinic_id: clinicId, status: 'booked', start_at: `2026-10-${String(i + 1).padStart(2, '0')}T02:00:00Z`, patients: { name: i === 0 ? '較早顧客' : '近期顧客', phone: i === 0 ? '0988000000' : '0911111111' }, services: { name: '服務', price: 100 } })),
      { id: 'foreign-appointment', clinic_id: 'foreign-brand', status: 'booked', start_at: '2026-10-25T02:00:00Z', patients: { name: '較早顧客', phone: '0988000000' }, services: { name: '外部服務', price: 999 } },
      { id: 'cancelled-appointment', clinic_id: clinicId, status: 'cancelled', start_at: '2026-10-26T02:00:00Z', patients: { name: '較早顧客', phone: '0988000000' }, services: { name: '服務', price: 100 } },
    ],
    registrations: [
      ...Array.from({ length: 21 }, (_, i) => ({ id: `registration-${i}`, clinic_id: clinicId, status: 'confirmed', created_at: `2026-10-${String(i + 1).padStart(2, '0')}T02:00:00Z`, registration_no: `R${i}`, name: i === 0 ? '較早學員' : '近期學員', amount: 200, events: { title: '活動' } })),
      { id: 'foreign-registration', clinic_id: 'foreign-brand', status: 'confirmed', created_at: '2026-10-25T02:00:00Z', registration_no: 'FOREIGN', name: '較早學員', amount: 999, events: { title: '外部活動' } },
      { id: 'cancelled-registration', clinic_id: clinicId, status: 'cancelled', created_at: '2026-10-26T02:00:00Z', registration_no: 'CANCELLED', name: '較早學員', amount: 200, events: { title: '活動' } },
    ],
  };
  function from(table) {
    const call = { table, filters: [], term: '', referencedTable: null, orders: [], range: null };
    calls.push(call);
    const query = {
      select() { return query; },
      eq(column, value) { call.filters.push(['eq', column, value]); return query; },
      in(column, values) { call.filters.push(['in', column, values]); return query; },
      or(value, options) { call.term = value.match(/ilike\.%(.*?)%/)?.[1] ?? ''; call.referencedTable = options?.referencedTable ?? null; return query; },
      order(column, options) { call.orders.push([column, options?.ascending !== false]); return query; },
      range(start, end) { call.range = [start, end]; return query; },
      then(resolve, reject) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: canary } }).then(resolve, reject);
        let rows = tables[table].filter(row => call.filters.every(([op, column, value]) => op === 'eq' ? row[column] === value : value.includes(row[column])));
        if (call.term) rows = rows.filter(row => {
          const candidate = call.referencedTable ? row.patients : row;
          return Object.values(candidate).some(value => String(value).includes(call.term));
        });
        for (const [column, ascending] of [...call.orders].reverse()) rows.sort((a, b) => ascending ? String(a[column]).localeCompare(String(b[column])) : String(b[column]).localeCompare(String(a[column])));
        return Promise.resolve({ data: rows.slice(call.range[0], call.range[1] + 1), error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const GET = load({
    '@/lib/admin': { getOptionalMember: async () => member ? { clinicId, supabase: { from } } : null, hasBrandPermission: () => allowed },
    '@/lib/admin-query': { adminQuery: value => value },
    '@/lib/http': { ok: data => Response.json({ ok: true, data }), fail: (error, status) => Response.json({ ok: false, error: status >= 500 ? '系統暫時無法完成操作' : error }, { status }) },
  });
  return {
    calls,
    async request(query) { const response = await GET({ nextUrl: new URL(`https://example.test/api/admin/checkout/sources?${query}`) }); return { status: response.status, body: await response.json() }; },
  };
}

test('the 501st patient can be found without exposing the full phone or another brand', async () => {
  const h = fixture();
  const first = await h.request('kind=patient');
  assert.equal(first.status, 200);
  assert.equal(first.body.data.options.length, 20);
  assert.equal(first.body.data.hasMore, true);
  const found = await h.request(`kind=patient&q=${encodeURIComponent('Z 顧客末筆')}`);
  assert.equal(found.status, 200);
  assert.deepEqual(Array.from(found.body.data.options, row => row.value), ['patient:patient-500']);
  assert(!JSON.stringify(found.body).includes('0900000500'));
  assert(!JSON.stringify(found.body).includes('foreign-'));
  assert(h.calls.every(call => call.filters.some(([op, field, value]) => op === 'eq' && field === 'clinic_id' && value === clinicId)));
});

test('older eligible appointments and registrations remain searchable', async () => {
  const h = fixture();
  const appointment = await h.request(`kind=appointment&q=${encodeURIComponent('較早顧客')}`);
  const registration = await h.request(`kind=registration&q=${encodeURIComponent('較早學員')}`);
  assert.deepEqual(Array.from(appointment.body.data.options, row => row.value), ['appointment:appointment-0']);
  assert.deepEqual(Array.from(registration.body.data.options, row => row.value), ['registration:registration-0']);
  assert.equal(appointment.body.data.options[0].amount, 100);
  assert.equal(registration.body.data.options[0].amount, 200);
  assert(!JSON.stringify(appointment.body).includes('foreign-'));
  assert(!JSON.stringify(registration.body).includes('cancelled-'));
  assert.equal(h.calls.find(call => call.table === 'appointments').referencedTable, 'patients');
});

test('the next page is available and role denial happens before querying', async () => {
  const h = fixture();
  const page = await h.request('kind=appointment&page=1');
  assert.equal(page.status, 200);
  assert.equal(page.body.data.options.length, 1);
  assert.equal(page.body.data.hasMore, false);
  for (const options of [{ member: false, status: 401 }, { allowed: false, status: 403 }]) {
    const denied = fixture(options);
    assert.equal((await denied.request('kind=patient&q=顧客')).status, options.status);
    assert.equal(denied.calls.length, 0);
  }
});

test('invalid searches and database failures fail without exposing provider errors', async () => {
  const invalid = fixture();
  for (const query of ['kind=patient&q=a', 'kind=unknown', 'kind=patient&page=-1']) assert.equal((await invalid.request(query)).status, 400);
  assert.equal(invalid.calls.length, 0);
  const failed = fixture({ failTable: 'patients' });
  const result = await failed.request('kind=patient&q=顧客');
  assert.equal(result.status, 500);
  assert(!JSON.stringify(result.body).includes(canary));
});
