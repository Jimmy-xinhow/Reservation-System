import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('app/api/line/account-link/complete/route.ts', 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function routeHarness(publicHost) {
  const scopes = [];
  const reads = [];
  const writes = [];
  const service = {
    from(table) {
      reads.push(table);
      return {
        select() { throw new Error('foreign-brand route reached patient lookup'); },
        insert() { writes.push(table); throw new Error('foreign-brand route wrote data'); },
      };
    },
  };
  const imports = {
    'node:crypto': { createHash, randomBytes },
    '@/lib/supabase': { createServiceClient: () => service },
    '@/lib/rate-limit': { checkRateLimit: async () => ({ allowed: true }) },
    '@/lib/public-brand': {
      resolvePublicClinicIdFromScope: async (_service, scope) => {
        scopes.push(scope);
        return scope.host === publicHost && scope.clinicSlug === 'xinhow-pilot-20260930'
          ? null : 'foreign-brand-id';
      },
    },
    '@/lib/public-origin': { publicRequestOrigin: (origin) => origin },
    '@/lib/http': { fail: (message, status) => Response.json({ ok: false, error: message }, { status }) },
  };
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, require: (name) => imports[name] ?? {},
    URL, URLSearchParams, Headers, Response, Buffer, Date, console,
  });
  return { POST: exports.POST, scopes, reads, writes };
}

test('LINE account link refuses an existing other brand on a verified brand Host before any patient lookup', async () => {
  const host = 'booking-qa.laihowke.com';
  const harness = routeHarness(host);
  const form = new FormData();
  for (const [key, value] of Object.entries({
    clinic_slug: 'xinhow-pilot-20260930',
    link_token: 'synthetic-test-token', mode: 'existing',
    name: 'QA Boundary', phone: '0912345678', birthday: '1990-01-01',
  })) form.set(key, value);
  const response = await harness.POST({
    nextUrl: new URL('http://localhost/api/line/account-link/complete'),
    headers: new Headers({ host, 'x-forwarded-host': 'reservation-system-staging-staging.up.railway.app' }),
    formData: async () => form,
  });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'brand not found');
  assert.equal(harness.scopes.length, 1);
  assert.equal(harness.scopes[0].host, host);
  assert.equal(harness.scopes[0].clinicSlug, 'xinhow-pilot-20260930');
  assert.deepEqual(harness.reads, []);
  assert.deepEqual(harness.writes, []);
});
