import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const own = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const terms = { usage_scope: 'appointment', service_id: null, redeem_channels: ['appointment'] };

function load(path, dependencies) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Response, Headers, Date,
    require: (name) => dependencies[name] ?? {}, console: { error: () => {} } });
  return exports;
}

function fixture(planClinicId) {
  const membership = {
    membership_code: 'OWNCODE', status: 'active', credits_total: 3,
    credits_remaining: 2, starts_at: '2026-09-01T00:00:00Z', expires_at: null,
    redemption_snapshot: terms,
    membership_plans: { clinic_id: planClinicId, name: planClinicId === own ? 'Own plan' : 'FOREIGN_PLAN_NAME',
      usage_scope: 'both', service_id: null, redeem_channels: ['registration'] },
  };
  const queries = [];
  const db = { from(table) {
    const query = { select(fields) { queries.push({ table, fields }); return this; },
      eq() { return this; }, order() { return this; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'patient_memberships' ? [membership] : [], error: null }).then(resolve, reject); } };
    return query;
  } };
  const dependencies = {
    '@/lib/supabase': { createServiceClient: () => db },
    '@/lib/http': {
      rateLimitResponse: async () => null,
      getClinicSettings: async () => ({ memberships_enabled: true }),
      ok: (data) => Response.json({ ok: true, data }),
      fail: (message, status = 400) => Response.json({ ok: false, error: status >= 500 ? 'unavailable' : message }, { status }),
    },
    '@/lib/public-brand': { resolvePublicClinicId: async () => own },
    '@/lib/browser-booking': {
      verifyBrowserBookingToken: () => ({ clinicId: own, patientId: 'patient' }),
      createBrowserBookingToken: () => 'new-token',
    },
    '@/lib/rpc-error': { rpcFailure: () => { throw new Error('Unexpected RPC failure'); } },
  };
  dependencies['@/lib/membership-redemption'] = load('lib/membership-redemption.ts', dependencies);
  dependencies['@/lib/public-relation-scope'] = load('lib/public-relation-scope.ts', dependencies);
  const route = load('app/api/membership/portal/route.ts', dependencies);
  return { queries, run: () => route.POST({ json: async () => ({ browser_token: 'valid-token' }) }) };
}

test('member portal sends only same-brand plan labels and preserves purchase terms', async () => {
  const f = fixture(own);
  const response = await f.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.memberships[0].membership_plans.name, 'Own plan');
  assert.equal(body.data.memberships[0].membership_plans.usage_scope, 'appointment');
  assert.equal(body.data.memberships[0].membership_plans.clinic_id, undefined);
  assert.match(f.queries.find((row) => row.table === 'patient_memberships').fields, /membership_plans\(clinic_id,/);
});

test('member portal refuses a foreign embedded plan without returning membership or browser token', async () => {
  const response = await fixture(foreign).run();
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.ok(!body.includes('FOREIGN_PLAN_NAME'));
  assert.ok(!body.includes('OWNCODE'));
  assert.ok(!body.includes('valid-token'));
});

function lineFixture(planClinicId) {
  const sent = [];
  const service = { from(table) {
    const query = { select() { return this; }, eq() { return this; }, in() { return this; },
      order() { return this; }, limit() { return this; },
      then(resolve, reject) {
        const data = table === 'patients' ? [{ id: 'patient' }] : [{
          membership_code: 'OWNCODE', status: 'active', credits_total: 3,
          credits_remaining: 2, expires_at: null,
          membership_plans: { clinic_id: planClinicId,
            name: planClinicId === own ? 'Own plan' : 'FOREIGN_PLAN_NAME' },
        }];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      } };
    return query;
  } };
  const dependencies = {
    '@/lib/customer-entry': { customerEntryUrl: () => 'https://example.invalid/member' },
    '@/lib/line': { replyMessages: async (_replyToken, messages) => sent.push(messages) },
    '@/lib/line-ui-templates': {
      lineBrandTheme: () => ({ primary: '#123456', soft: '#eeeeee', accent: '#654321' }),
      buildLineExperienceCard: (input) => ({ type: 'flex', altText: input.altText,
        contents: { type: 'bubble', title: input.title } }),
    },
    '@/lib/line-flex-design': { lineFlexDesignForDelivery: () => null },
  };
  const journeys = load('lib/line-customer-journeys.ts', dependencies);
  const context = { service, clinicId: own, clinicSlug: 'own', clinicName: 'Own brand',
    liffId: null, baseUrl: 'https://example.invalid', lineAccessToken: 'token',
    brandTemplate: null, brandPrimaryColor: null, brandAccentColor: null };
  return { sent, run: () => journeys.replyMemberships('reply', 'line-user', context) };
}

test('LINE membership card uses the own-brand plan name', async () => {
  const f = lineFixture(own);
  await f.run();
  assert.equal(f.sent.length, 1);
  assert.match(JSON.stringify(f.sent), /Own plan/);
});

test('LINE membership card refuses a foreign plan before replying', async () => {
  const f = lineFixture(foreign);
  await assert.rejects(f.run(), /membership plan tenant mismatch/);
  assert.equal(f.sent.length, 0);
});
