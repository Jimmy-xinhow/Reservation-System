import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name === '@/lib/public-relation-scope') return load('lib/public-relation-scope.ts', dependencies);
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Response,
  });
  return exports;
}

async function lookup(relatedClinicId) {
  let projection = '';
  const registration = {
    registration_no: 'R123', status: 'confirmed', payment_status: 'not_required',
    amount: 0, name: 'Own customer', created_at: '2026-09-28T00:00:00Z',
    events: { clinic_id: relatedClinicId, title: relatedClinicId === 'own' ? 'Own event' : 'Foreign event secret' },
    event_sessions: { clinic_id: relatedClinicId, name: relatedClinicId === 'own' ? 'Own session' : 'Foreign session secret', start_at: '2026-10-12T00:00:00Z' },
  };
  const query = new Proxy({}, {
    get(_, key) {
      if (key === 'maybeSingle') return async () => ({ data: registration, error: null });
      return (...args) => {
        if (key === 'select') projection = args[0];
        return query;
      };
    },
  });
  const dependencies = {
    '@/lib/supabase': { createServiceClient: () => ({ from: () => query }) },
    '@/lib/public-brand': { resolvePublicClinicId: async () => 'own' },
    '@/lib/http': {
      rateLimitResponse: async () => null,
      ok: data => Response.json({ ok: true, data }),
      fail: (error, status = 400) => Response.json({ ok: false, error }, { status }),
    },
  };
  const POST = load('app/api/registration/my/route.ts', dependencies).POST;
  const response = await POST({ json: async () => ({ registration_no: 'R123', phone: '0900000000' }) });
  return { response, projection };
}

test('registration lookup retains own event and session without exposing internal brand IDs', async () => {
  const { response, projection } = await lookup('own');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.events?.title, 'Own event');
  assert.equal(result.data.event_sessions?.name, 'Own session');
  assert(!JSON.stringify(result).includes('"clinic_id"'));
  assert(projection.includes('events(clinic_id,title)'));
  assert(projection.includes('event_sessions(clinic_id,name'));
});

test('registration lookup masks foreign event and session while retaining own registration', async () => {
  const { response } = await lookup('foreign');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.registration_no, 'R123');
  assert.equal(result.data.events, null);
  assert.equal(result.data.event_sessions, null);
  assert(!JSON.stringify(result).includes('Foreign event secret'));
  assert(!JSON.stringify(result).includes('Foreign session secret'));
});
