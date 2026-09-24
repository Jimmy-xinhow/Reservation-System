import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const clinicId = 'fixture-brand';
const secret = 'Authorization=Bearer secret-token';

function loadRoute(dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/api/admin/service-record-sources/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Promise, Number, Array, URLSearchParams,
  });
  return exports.GET;
}

function fixture({ member = { clinicId }, allowed = true, failure } = {}) {
  const calls = [];
  let serviceCalls = 0;
  const rows = {
    appointments: Array.from({ length: 35 }, (_, i) => ({
      id: `appointment-${i}`, clinic_id: clinicId, start_at: `2026-09-${String(30 - (i % 30)).padStart(2, '0')}T02:00:00Z`,
      status: 'done', patients: { name: i === 34 ? '歷史顧客' : `近期顧客${i}`, phone: i === 34 ? '0999000000' : '0911111111' }, services: { name: '服務' },
    })),
    registrations: Array.from({ length: 35 }, (_, i) => ({
      id: `registration-${i}`, clinic_id: clinicId, patient_id: `patient-${i}`, created_at: `2026-09-${String(30 - (i % 30)).padStart(2, '0')}T02:00:00Z`,
      status: 'confirmed', patients: { name: i === 34 ? '歷史學員' : `近期學員${i}`, phone: i === 34 ? '0988000000' : '0922222222' }, events: { title: '課程' }, event_sessions: null,
    })),
  };
  for (const table of Object.keys(rows)) rows[table].push({ ...rows[table][0], id: `foreign-${table}`, clinic_id: 'foreign-brand', patients: { name: '外品牌客戶', phone: '0977000000' } });

  function from(table) {
    const call = { table, filters: [], search: null, range: null };
    calls.push(call);
    const query = {
      select() { return query; },
      eq(column, value) { call.filters.push(['eq', column, value]); return query; },
      neq(column, value) { call.filters.push(['neq', column, value]); return query; },
      not(column, operator, value) { call.filters.push(['not', column, operator, value]); return query; },
      or(value, options) { call.search = [value, options]; return query; },
      order() { return query; },
      range(start, end) { call.range = [start, end]; return query; },
      then(resolve, reject) {
        if (failure?.table === table) {
          const result = failure.mode === 'throw' ? Promise.reject(new Error(secret)) : Promise.resolve({ data: null, error: { message: secret } });
          return result.then(resolve, reject);
        }
        let data = rows[table].filter(row => row.clinic_id === call.filters.find(([op, key]) => op === 'eq' && key === 'clinic_id')?.[2]);
        if (call.search) {
          const term = call.search[0].match(/name\.ilike\.%(.*?)%/)?.[1] ?? '';
          data = data.filter(row => row.patients.name.includes(term) || row.patients.phone.includes(term));
        }
        return Promise.resolve({ data: data.slice(call.range[0], call.range[1] + 1), error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const GET = loadRoute({
    '@/lib/admin': { getOptionalMember: async () => member, hasBrandPermission: () => allowed },
    '@/lib/admin-query': { adminQuery: value => value },
    '@/lib/http': {
      ok: data => Response.json({ ok: true, data }),
      fail: (error, status) => Response.json({ ok: false, error: status >= 500 ? '系統暫時無法完成操作' : error }, { status }),
    },
    '@/lib/slots': { formatDateTime: value => value },
    '@/lib/supabase': { createServiceClient: () => { serviceCalls++; return { from }; } },
  });
  const request = async (query = '') => {
    const url = new URL(`https://example.test/api/admin/service-record-sources${query}`);
    const response = await GET({ nextUrl: url });
    return { status: response.status, body: await response.json() };
  };
  return { request, calls, serviceCalls: () => serviceCalls };
}

test('older appointment and registration can be found by name or phone, within clinic only', async () => {
  const h = fixture();
  const byName = await h.request('?q=%E6%AD%B7%E5%8F%B2');
  assert.equal(byName.status, 200);
  assert.deepEqual(Array.from(byName.body.data.sources, row => row.id), ['appointment-34', 'registration-34']);
  assert(!JSON.stringify(byName.body).includes('0999000000'));
  assert(!JSON.stringify(byName.body).includes('foreign-'));
  const byPhone = await h.request('?q=0988000000');
  assert.deepEqual(Array.from(byPhone.body.data.sources, row => row.id), ['registration-34']);
  assert(h.calls.every(call => call.filters.some(([op, key, value]) => op === 'eq' && key === 'clinic_id' && value === clinicId)));
  assert(h.calls.filter(call => call.search).every(call => call.search[1].referencedTable === 'patients'));
});

test('page two exposes the older item without a 30-item ceiling', async () => {
  const h = fixture();
  const first = await h.request();
  assert.equal(first.body.data.sources.length, 60);
  assert.equal(first.body.data.hasMore, true);
  const second = await h.request('?page=1');
  assert.equal(second.status, 200);
  assert(Array.from(second.body.data.sources, row => row.id).includes('appointment-34'));
  assert(Array.from(second.body.data.sources, row => row.id).includes('registration-34'));
  assert.equal(second.body.data.hasMore, false);
});

test('session and role rejection happen before service-role client creation', async () => {
  for (const options of [{ member: null }, { allowed: false }]) {
    const h = fixture(options);
    const result = await h.request('?q=%E6%AD%B7%E5%8F%B2');
    assert.equal(result.status, options.member === null ? 401 : 403);
    assert.equal(h.serviceCalls(), 0);
  }
});

test('invalid query and database errors do not expose provider text', async () => {
  const invalid = fixture();
  assert.equal((await invalid.request('?q=a')).status, 400);
  assert.equal((await invalid.request('?page=-1')).status, 400);
  assert.equal(invalid.serviceCalls(), 0);
  for (const mode of ['error', 'throw']) {
    const h = fixture({ failure: { table: 'registrations', mode } });
    const result = await h.request('?q=%E6%AD%B7%E5%8F%B2');
    assert.equal(result.status, 500);
    assert(!JSON.stringify(result.body).includes(secret));
  }
});
