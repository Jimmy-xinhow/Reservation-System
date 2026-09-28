import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name in deps) return deps[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    FormData,
  });
  return exports;
}

function actionFixture(file, guardName) {
  const calls = { guard: 0, business: 0 };
  const supabase = {
    from() { calls.business += 1; throw new Error('BUSINESS_QUERY_AFTER_DISABLED'); },
    rpc() { calls.business += 1; throw new Error('BUSINESS_RPC_AFTER_DISABLED'); },
  };
  const member = { supabase, clinicId: 'fixture-brand', user: { id: 'fixture-user' } };
  const guard = async received => {
    calls.guard += 1;
    assert.equal(received.supabase, supabase);
    assert.equal(received.clinicId, member.clinicId);
    throw new Error('MODULE_DISABLED');
  };
  const actions = load(file, {
    '@/lib/admin-query': { adminQuery: async value => value, adminErrorMessage: () => 'SAFE_ERROR' },
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect() { throw new Error('REDIRECT'); } },
    'node:crypto': { createHash() { throw new Error('CRYPTO_AFTER_DISABLED'); }, randomBytes() { throw new Error('RANDOM_AFTER_DISABLED'); } },
    '@/lib/admin': { requireAdmin: async () => member, requireOperator: async () => member },
    '@/lib/admin-modules': { [guardName]: guard },
    '@/lib/supabase': { createServiceClient() { calls.business += 1; throw new Error('SERVICE_CLIENT_AFTER_DISABLED'); } },
  });
  return { actions, calls };
}

const families = [
  {
    file: 'app/admin/events/actions.ts',
    guard: 'assertEventsEnabled',
    names: [
      'createEventAction', 'regeneratePrivateEventLinkAction', 'setEventStatusAction',
      'createEventSessionAction', 'createTicketTypeAction', 'addRegistrationFieldAction',
    ],
  },
  {
    file: 'app/admin/memberships/actions.ts',
    guard: 'assertMembershipsEnabled',
    names: [
      'saveMembershipPlanAction', 'redeemPatientMembershipAction', 'toggleMembershipPlanAction',
      'grantPatientMembershipAction', 'createDiscountCodeAction', 'toggleDiscountCodeAction',
      'createMembershipLevelAction', 'toggleMembershipLevelAction',
      'saveMembershipPlanLevelPriceAction', 'assignPatientMembershipLevelAction',
    ],
  },
];

for (const family of families) {
  for (const name of family.names) {
    test(`${name} rejects stale form before business access when module is disabled`, async () => {
      const { actions, calls } = actionFixture(family.file, family.guard);
      await assert.rejects(actions[name](new FormData()), { message: 'MODULE_DISABLED' });
      assert.deepEqual(calls, { guard: 1, business: 0 });
    });
  }
}

test('module setting helper denies both event and membership modules and fails closed on query error', async () => {
  for (const module of ['events', 'memberships']) {
    let reads = 0;
    const client = { from(table) {
      assert.equal(table, 'clinic_settings');
      return {
        select(projection) {
          assert.match(projection, /events_enabled/);
          assert.match(projection, /memberships_enabled/);
          return this;
        },
        eq(column, id) {
          assert.equal(column, 'clinic_id');
          assert.equal(id, 'fixture-brand');
          return this;
        },
        maybeSingle() {
          reads += 1;
          return Promise.resolve({ data: { events_enabled: false, memberships_enabled: false }, error: null });
        },
      };
    } };
    const helpers = load('lib/admin-modules.ts', {
      'server-only': {},
      '@/lib/admin-query': { adminQuery: async value => value, adminErrorMessage: () => 'SAFE_ERROR' },
    });
    const check = module === 'events' ? helpers.assertEventsEnabled : helpers.assertMembershipsEnabled;
    await assert.rejects(check({ supabase: client, clinicId: 'fixture-brand' }), /尚未啟用/);
    assert.equal(reads, 1);
  }
  const failedClient = { from() {
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: { message: 'PRIVATE_DB_FAILURE' } }); },
    };
  } };
  const helpers = load('lib/admin-modules.ts', {
    'server-only': {},
    '@/lib/admin-query': { adminQuery: async value => value, adminErrorMessage: () => 'SAFE_ERROR' },
  });
  await assert.rejects(helpers.assertEventsEnabled({ supabase: failedClient, clinicId: 'fixture-brand' }), /SAFE_ERROR/);
  await assert.rejects(helpers.assertMembershipsEnabled({ supabase: failedClient, clinicId: 'fixture-brand' }), /SAFE_ERROR/);
});
