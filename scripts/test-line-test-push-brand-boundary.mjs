import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function actionWithPatient(patientState, calls, moduleEnabled = true, destination = 'own-destination', verifiedIdentity = true) {
  let table = '';
  const query = {
    select: () => query,
    eq: (column, value) => { calls.filters.push([table, column, value]); return query; },
    limit: () => query,
    maybeSingle: async () => table === 'patients'
      ? patientState === 'error'
        ? { data: null, error: { message: 'private database detail' } }
        : { data: patientState ? { id: 'own-patient' } : null, error: null }
      : { data: { line_destination: destination }, error: null },
  };
  const supabase = { from: (name) => { table = name; return query; } };
  const source = readFileSync('app/admin/line-actions.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: (path) => { throw new Error(`redirect:${path}`); } },
    'node:crypto': awaitImportCrypto(),
    '@/lib/admin': { requireAdmin: async () => ({ supabase, clinicId: 'own-brand' }) },
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => moduleEnabled },
    '@/lib/supabase': { createServiceClient: () => ({}) },
    '@/lib/line-customer-identity': { isVerifiedLineRecipient: async (_svc, brand, to, patientId) => {
      calls.identityChecks.push([brand, to, patientId]);
      if (verifiedIdentity === 'error') throw new Error('private identity detail');
      return verifiedIdentity;
    } },
    '@/lib/delivery-error': { deliveryError: () => 'safe-category' },
    '@/lib/line': {
      lineAccessTokenForDestination: async () => 'own-brand-token',
      pushMessages: async (to) => { calls.pushed.push(to); },
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, FormData,
    console: { error: () => {} },
    require: (name) => dependencies[name] ?? {} });
  return exports.sendTestPushAction;
}

function awaitImportCrypto() {
  return { randomUUID: () => 'test-id' };
}

function recipient(value) {
  const data = new FormData();
  data.set('line_user_id', value);
  return data;
}

test('foreign LINE recipient cannot receive a brand test push', async () => {
  const calls = { filters: [], pushed: [], identityChecks: [] };
  const action = actionWithPatient(false, calls);
  await assert.rejects(action(recipient('foreign-line-user')), /redirect:\/admin\/line\?test=err$/);
  assert.deepEqual(calls.pushed, []);
  assert.deepEqual(calls.filters.slice(0, 3), [
    ['patients', 'clinic_id', 'own-brand'],
    ['patients', 'line_user_id', 'foreign-line-user'],
    ['patients', 'active', true],
  ]);
});

test('active patient in the current brand can receive a test push', async () => {
  const calls = { filters: [], pushed: [], identityChecks: [] };
  const action = actionWithPatient(true, calls);
  await assert.rejects(action(recipient('own-line-user')), /redirect:\/admin\/line\?test=ok$/);
  assert.deepEqual(calls.pushed, ['own-line-user']);
  assert.deepEqual(calls.identityChecks, [['own-brand', 'own-line-user', 'own-patient']]);
});

test('an editable local patient row cannot authorize push without verified LINE identity', async () => {
  const calls = { filters: [], pushed: [], identityChecks: [] };
  const action = actionWithPatient(true, calls, true, 'own-destination', false);
  await assert.rejects(action(recipient('forged-line-user')), /redirect:\/admin\/line\?test=err$/);
  assert.deepEqual(calls.pushed, []);
});

test('identity lookup failure fails closed before LINE push', async () => {
  const calls = { filters: [], pushed: [], identityChecks: [] };
  const action = actionWithPatient(true, calls, true, 'own-destination', 'error');
  await assert.rejects(action(recipient('own-line-user')), /redirect:\/admin\/line\?test=err$/);
  assert.deepEqual(calls.pushed, []);
});

test('recipient lookup failure fails closed before LINE push', async () => {
  const calls = { filters: [], pushed: [], identityChecks: [] };
  const action = actionWithPatient('error', calls);
  await assert.rejects(action(recipient('any-line-user')), /redirect:\/admin\/line\?test=err$/);
  assert.deepEqual(calls.pushed, []);
});

test('disabled LINE module cannot send a test push', async () => {
  const calls = { filters: [], pushed: [], identityChecks: [] };
  const action = actionWithPatient(true, calls, false);
  await assert.rejects(action(recipient('own-line-user')), /此品牌未啟用 LINE 訊息/);
  assert.deepEqual(calls.pushed, []);
});

test('missing brand destination cannot use the legacy global LINE token', async () => {
  const calls = { filters: [], pushed: [], identityChecks: [] };
  const action = actionWithPatient(true, calls, true, null);
  await assert.rejects(action(recipient('own-line-user')), /redirect:\/admin\/line\?test=err$/);
  assert.deepEqual(calls.pushed, []);
});
