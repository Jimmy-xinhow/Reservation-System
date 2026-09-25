import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function loadRoute(service) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/api/admin/beauty-photo/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, Response, Buffer, File,
    require(name) {
      if (name === 'node:crypto') return { randomBytes: () => Buffer.alloc(16, 1) };
      if (name === '@/lib/admin') return { requireOperator: async () => ({ clinicId: 'brand-a' }) };
      if (name === '@/lib/supabase') return { createServiceClient: () => service };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports.POST;
}

function fixture({ consent = false, brand = 'brand-a', updateFails = false } = {}) {
  const calls = { uploaded: [], removed: [], filters: [], updated: [] };
  const row = { id: 'record-1', clinic_id: brand, record_type: 'service_record', photo_consent: consent, private_photo_paths: [], updated_at: '2026-09-24T00:00:00Z' };
  const storageBucket = {
    async upload(path) { calls.uploaded.push(path); return { error: null }; },
    async remove(paths) { calls.removed.push(...paths); return { error: null }; },
    async createSignedUrl() { return { data: { signedUrl: 'https://private.example.test/signed' } }; },
  };
  const service = {
    storage: {
      async getBucket() { return { data: { public: false } }; },
      async createBucket() { throw new Error('unexpected bucket creation'); },
      from() { return storageBucket; },
    },
    from(table) {
      assert.equal(table, 'patient_records');
      const filters = [];
      let nextPaths;
      const query = {
        select() { return query; },
        update(value) { nextPaths = value.private_photo_paths; calls.updated.push(value); return query; },
        eq(column, value) { filters.push([column, value]); calls.filters.push([column, value]); return query; },
        async maybeSingle() {
          const allowed = filters.every(([column, value]) => row[column] === value);
          return { data: allowed ? structuredClone(row) : null, error: null };
        },
        then(resolve) {
          const allowed = filters.every(([column, value]) => row[column] === value);
          if (allowed && !updateFails) { row.private_photo_paths = nextPaths; row.updated_at = '2026-09-24T00:00:01Z'; }
          return Promise.resolve({ data: allowed && !updateFails ? [{ id: row.id }] : [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const POST = loadRoute(service);
  async function request(recordId = 'record-1') {
    const form = new FormData(); form.set('record_id', recordId); form.set('file', new File([png], 'fixture.png', { type: 'image/png' }));
    const response = await POST({ formData: async () => form });
    return { status: response.status, body: await response.json() };
  }
  return { calls, row, request };
}

test('photo cannot upload before a persisted, consented record exists', async () => {
  for (const options of [{}, { consent: true, brand: 'brand-b' }]) {
    const h = fixture(options);
    assert.equal((await h.request()).status, 403);
    assert.equal(h.calls.uploaded.length, 0);
  }
  const h = fixture({ consent: true });
  assert.equal((await h.request('missing-record')).status, 403);
  assert.equal(h.calls.uploaded.length, 0);
});

test('consented upload is private and linked to its record', async () => {
  const h = fixture({ consent: true });
  const result = await h.request();
  assert.equal(result.status, 200);
  assert.equal(h.calls.uploaded.length, 1);
  assert.equal(h.calls.uploaded[0], h.row.private_photo_paths[0]);
  assert(h.calls.uploaded[0].startsWith('brand-a/record-1/'));
  assert.equal(h.calls.removed.length, 0);
  assert(h.calls.filters.some(([key, value]) => key === 'clinic_id' && value === 'brand-a'));
});

test('failed record link removes the exact newly uploaded object', async () => {
  const h = fixture({ consent: true, updateFails: true });
  assert.equal((await h.request()).status, 409);
  assert.deepEqual(h.calls.removed, h.calls.uploaded);
  assert.deepEqual(h.row.private_photo_paths, []);
});
