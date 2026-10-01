import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadChatRoute(enabled, calls, role = 'staff') {
  const source = fs.readFileSync('app/api/admin/chat/route.ts', 'utf8');
  const exports = {};
  const member = { clinicId: 'qa-clinic', role, supabase: {}, user: { id: 'qa-user' } };
  const deps = {
    '@/lib/admin': { requireMember: async () => member, requireOperator: async () => member },
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => { calls.push('module'); return enabled; } },
    '@/lib/http': {
      ok: data => Response.json({ ok: true, data }),
      fail: (error, status = 400) => Response.json({ ok: false, error }, { status }),
    },
    '@/lib/chatQueries': {
      buildThreads: async () => { calls.push('threads'); return [{ lineUserId: 'qa-line', lastBody: 'PRIVATE_CHAT_CANARY' }]; },
      getThreadMessages: async () => { calls.push('messages'); return [{ body: 'PRIVATE_CHAT_CANARY' }]; },
      unreadCount: async () => { calls.push('unread'); return 1; },
      setChatBlock: async () => { calls.push('block'); },
      insertStaffMessage: async () => { calls.push('insert'); return 'qa-message'; },
    },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    Response,
    Error,
    require: name => deps[name] ?? {},
  });
  return exports;
}

test('disabled LINE module rejects chat reads before exposing old messages', async () => {
  const calls = [];
  const route = loadChatRoute(false, calls);
  for (const type of ['threads', 'messages', 'unread']) {
    const response = await route.GET({ nextUrl: new URL(`https://example.invalid/api/admin/chat?type=${type}&u=qa-line`) });
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /PRIVATE_CHAT_CANARY/);
  }
  assert.deepEqual(calls.filter(call => call !== 'module'), []);
});

test('disabled LINE module rejects chat writes before changing conversation state', async () => {
  const calls = [];
  const route = loadChatRoute(false, calls);
  for (const action of ['block', 'send']) {
    const response = await route.POST({ json: async () => ({ action, lineUserId: 'qa-line', body: 'PRIVATE_CHAT_CANARY' }) });
    assert.equal(response.status, 403);
  }
  assert.deepEqual(calls.filter(call => call !== 'module'), []);
});

test('provider chat reads are empty without accessing clinic settings denied by RLS', async () => {
  const calls = [];
  const route = loadChatRoute(true, calls, 'provider');
  for (const [type, key, expected] of [
    ['threads', 'threads', []],
    ['messages', 'messages', []],
    ['unread', 'count', 0],
  ]) {
    const response = await route.GET({ nextUrl: new URL(`https://example.invalid/api/admin/chat?type=${type}&u=qa-line`) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data[key], expected);
  }
  assert.deepEqual(calls, []);
});
