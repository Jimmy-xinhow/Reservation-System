import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function routeWithThread(thread, calls, verifiedIdentity = true) {
  const query = {
    select: () => query,
    eq: (column, value) => { calls.filters.push([column, value]); return query; },
    limit: () => query,
    maybeSingle: async () => thread === 'error'
      ? { data: null, error: { message: 'private database detail' } }
      : { data: thread ? { id: 'local-message' } : null, error: null },
  };
  const supabase = { from: (table) => { calls.tables.push(table); return query; } };
  const member = { clinicId: 'own-brand', supabase, user: { id: 'operator' } };
  const dependencies = {
    '@/lib/admin': { requireOperator: async () => member },
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => true },
    '@/lib/http': {
      ok: (data) => Response.json({ ok: true, data }),
      fail: (message, status = 400) => Response.json({ ok: false,
        error: status >= 500 ? '系統暫時無法完成操作' : message }, { status }),
    },
    '@/lib/chatQueries': {
      setChatBlock: async () => { calls.writes.push('block'); },
      insertStaffMessage: async () => { calls.writes.push('insert'); return 'new-message'; },
    },
    '@/lib/supabase': { createServiceClient: () => ({}) },
    '@/lib/line-customer-identity': { getLineCustomerIdentity: async (_svc, brand, to) => {
      calls.identityChecks.push([brand, to]);
      if (verifiedIdentity === 'error') throw new Error('private identity detail');
      return verifiedIdentity ? { displayName: 'Verified' } : null;
    } },
    '@/lib/line': { pushMessages: async () => { calls.writes.push('push'); } },
  };
  const exports = {};
  const source = readFileSync('app/api/admin/chat/route.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Response, Error,
    require: (name) => dependencies[name] ?? {} });
  return exports;
}

test('forged recipient outside the current brand has no chat write or LINE push', async () => {
  for (const action of ['send', 'block', 'unblock']) {
    const calls = { filters: [], tables: [], writes: [], identityChecks: [] };
    const route = routeWithThread(false, calls);
    const response = await route.POST({ json: async () => ({ action,
      lineUserId: 'foreign-line-user', body: 'must not send' }) });
    assert.equal(response.status, 404, action);
    assert.deepEqual(calls.tables, ['chat_messages']);
    assert.deepEqual(calls.filters, [['clinic_id', 'own-brand'],
      ['line_user_id', 'foreign-line-user']]);
    assert.deepEqual(calls.writes, []);
  }
});

test('an existing local thread can still be blocked', async () => {
  const calls = { filters: [], tables: [], writes: [], identityChecks: [] };
  const route = routeWithThread(true, calls);
  const response = await route.POST({ json: async () => ({ action: 'block',
    lineUserId: 'local-line-user' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.writes, ['block']);
  assert.deepEqual(calls.identityChecks, [['own-brand', 'local-line-user']]);
});

test('a forged local chat row without a verified LINE identity cannot send or block', async () => {
  for (const action of ['send', 'block', 'unblock']) {
    const calls = { filters: [], tables: [], writes: [], identityChecks: [] };
    const route = routeWithThread(true, calls, false);
    const response = await route.POST({ json: async () => ({ action,
      lineUserId: 'forged-line-user', body: 'must not send' }) });
    assert.equal(response.status, 404);
    assert.deepEqual(calls.writes, []);
  }
});

test('identity lookup failure cannot create or deliver a chat message', async () => {
  const calls = { filters: [], tables: [], writes: [], identityChecks: [] };
  const route = routeWithThread(true, calls, 'error');
  const response = await route.POST({ json: async () => ({ action: 'send',
    lineUserId: 'local-line-user', body: 'must not send' }) });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private identity detail/);
  assert.deepEqual(calls.writes, []);
});

test('thread lookup failure does not create or deliver a message', async () => {
  const calls = { filters: [], tables: [], writes: [], identityChecks: [] };
  const route = routeWithThread('error', calls);
  const response = await route.POST({ json: async () => ({ action: 'send',
    lineUserId: 'local-line-user', body: 'must not send' }) });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private database detail/);
  assert.deepEqual(calls.writes, []);
});
