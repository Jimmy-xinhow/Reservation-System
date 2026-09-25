import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const clinicId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const targetId = '33333333-3333-4333-8333-333333333333';
const foreignId = '44444444-4444-4444-8444-444444444444';
const canary = 'PRIVATE_DB_ERROR';

function route(deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/api/admin/patients/merge-targets/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Promise, Number, Array, Intl, console });
  return exports.GET;
}

function fixture({ member = true, manager = true, fault = false } = {}) {
  const calls = [];
  const patients = [
    { id: sourceId, clinic_id: clinicId, active: true, name: 'A 合併來源', phone: '0900000000' },
    ...Array.from({ length: 500 }, (_, index) => ({
      id: `candidate-${index}`, clinic_id: clinicId, active: true,
      name: `B 候選 ${String(index).padStart(3, '0')}`, phone: `09${String(index).padStart(8, '0')}`,
    })),
    { id: targetId, clinic_id: clinicId, active: true, name: 'Z 最後顧客', phone: '0987654321' },
    { id: foreignId, clinic_id: 'another-brand', active: true, name: 'Z 最後顧客', phone: '0999999999' },
    { id: 'inactive', clinic_id: clinicId, active: false, name: 'Z 最後顧客', phone: '0999999998' },
  ];
  function from(table) {
    assert.equal(table, 'patients');
    const call = { filters: [], term: '', range: null };
    calls.push(call);
    const query = {
      select() { return query; },
      eq(field, value) { call.filters.push(['eq', field, value]); return query; },
      neq(field, value) { call.filters.push(['neq', field, value]); return query; },
      or(value) { call.term = value.match(/ilike\.%(.*?)%/)?.[1] ?? ''; return query; },
      order() { return query; },
      maybeSingle() {
        if (fault) return Promise.resolve({ data: null, error: { message: canary } });
        const row = patients.find((patient) => call.filters.every(([op, field, value]) => op === 'eq' ? patient[field] === value : patient[field] !== value));
        return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
      },
      range(from, to) {
        call.range = [from, to];
        if (fault) return Promise.resolve({ data: null, error: { message: canary } });
        let rows = patients.filter((patient) => call.filters.every(([op, field, value]) => op === 'eq' ? patient[field] === value : patient[field] !== value));
        if (call.term) rows = rows.filter((row) => row.name.includes(call.term) || row.phone.includes(call.term));
        rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
    };
    return query;
  }
  const GET = route({
    '@/lib/admin': {
      getOptionalMember: async () => member ? { clinicId, supabase: { from } } : null,
      hasBrandPermission: () => manager,
    },
    '@/lib/admin-query': { adminQuery: (value) => value },
    '@/lib/http': {
      ok: (data) => Response.json({ ok: true, data }),
      fail: (error, status) => Response.json({ ok: false, error: status >= 500 ? '系統暫時無法完成操作' : error }, { status }),
    },
  });
  return { calls, async request(params) {
    const response = await GET({ nextUrl: new URL(`https://example.test/api/admin/patients/merge-targets?${params}`) });
    return { status: response.status, body: await response.json() };
  } };
}

test('the 501st merge target is searchable without preloading patient PII or another brand', async () => {
  const h = fixture();
  const found = await h.request(`source=${sourceId}&q=${encodeURIComponent('Z 最後顧客')}`);
  assert.equal(found.status, 200);
  assert.deepEqual(Array.from(found.body.data.options, (row) => row.id), [targetId]);
  assert(!JSON.stringify(found.body).includes('0987654321'));
  assert(!JSON.stringify(found.body).includes(foreignId));
  assert(h.calls.every((call) => call.filters.some(([op, field, value]) => op === 'eq' && field === 'clinic_id' && value === clinicId)));
});

test('matching results paginate and exclude the source patient', async () => {
  const h = fixture();
  const first = await h.request(`source=${sourceId}&q=候選&page=0`);
  const next = await h.request(`source=${sourceId}&q=候選&page=1`);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.options.length, 20);
  assert.equal(first.body.data.hasMore, true);
  assert.equal(next.body.data.options.length, 20);
  assert(!JSON.stringify(first.body).includes(sourceId));
});

test('role, source ownership and invalid input fail before target listing', async () => {
  for (const [options, status] of [[{ member: false }, 401], [{ manager: false }, 403]]) {
    const h = fixture(options);
    assert.equal((await h.request(`source=${sourceId}&q=候選`)).status, status);
    assert.equal(h.calls.length, 0);
  }
  const h = fixture();
  assert.equal((await h.request(`source=${foreignId}&q=候選`)).status, 404);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.request(`source=${sourceId}&q=a`)).status, 400);
  assert.equal((await h.request(`source=${sourceId}&q=候選&page=-1`)).status, 400);
});

test('database failures never return provider error text', async () => {
  const h = fixture({ fault: true });
  const failed = await h.request(`source=${sourceId}&q=候選`);
  assert.equal(failed.status, 500);
  assert(!JSON.stringify(failed.body).includes(canary));
});
