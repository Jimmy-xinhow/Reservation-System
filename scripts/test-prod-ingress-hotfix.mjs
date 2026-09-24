import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require: name => deps[name] ?? {}, Response, Headers, URL, URLSearchParams, Buffer, Error,
  });
  return exports;
}

for (const [file, methods] of [
  ['app/api/registration/checkin-live/route.ts', ['GET']],
  ['app/api/registration/checkin-search/route.ts', ['GET', 'POST']],
  ['app/api/registration/checkin/route.ts', ['POST']],
]) {
  test(`${file} preserves unauthenticated redirect`, async () => {
    const redirect = new Error('NEXT_REDIRECT');
    const route = load(file, {
      '@/lib/admin': { requireOperator: async () => { throw redirect; } },
      '@/lib/http': { fail: () => { throw new Error('redirect was converted to 500'); } },
    });
    for (const method of methods) await assert.rejects(route[method]({}), error => error === redirect);
  });
}

function webhookHarness() {
  let serviceCalls = 0;
  let brandQueries = 0;
  const service = {
    from(table) {
      brandQueries++;
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: table === 'clinics' ? { id: 'brand', slug: 'fixture', name: 'Fixture' } : {}, error: null }),
      };
      return query;
    },
  };
  const route = load('app/api/line/webhook/route.ts', {
    '@/lib/supabase': { CLINIC_ID: 'brand', createServiceClient: () => { serviceCalls++; return service; } },
    '@/lib/line': {
      lineCredentialsForDestination: async () => ({ channelSecret: 'test-secret', accessToken: 'test-token' }),
      verifyLineSignature: (_raw, signature, secret) => signature === 'valid-signature' && secret === 'test-secret',
    },
    '@/lib/line-channel': { getClinicLineChannelContext: async () => ({ enabled: true, liffId: null }) },
    '@/lib/public-origin': { publicRequestOrigin: value => value },
  });
  const run = (body, signature) => route.POST({
    text: async () => JSON.stringify(body),
    headers: new Headers(signature ? { 'x-line-signature': signature } : {}),
    nextUrl: new URL('https://example.invalid/api/line/webhook'),
  });
  return { run, counts: () => ({ serviceCalls, brandQueries }) };
}

test('malformed LINE webhook payloads stop before service access', async () => {
  for (const payload of [null, [], { destination: 1 }, { events: [null] }, { events: [{ type: '' }] }]) {
    const harness = webhookHarness();
    const response = await harness.run(payload, 'valid-signature');
    assert.equal(response.status, 400);
    assert.equal(harness.counts().serviceCalls, 0);
  }
});

test('missing LINE signature rejects before credentials or database access', async () => {
  const harness = webhookHarness();
  const response = await harness.run({ events: [] });
  assert.equal(response.status, 401);
  assert.deepEqual(harness.counts(), { serviceCalls: 0, brandQueries: 0 });
});

test('wrong LINE signature never reaches brand or event queries', async () => {
  const harness = webhookHarness();
  const response = await harness.run({ events: [] }, 'wrong-signature');
  assert.equal(response.status, 401);
  assert.equal(harness.counts().brandQueries, 0);
});

test('valid empty LINE verification request remains accepted', async () => {
  const harness = webhookHarness();
  const response = await harness.run({ events: [] }, 'valid-signature');
  assert.equal(response.status, 200);
  assert.equal(harness.counts().serviceCalls, 1);
});
