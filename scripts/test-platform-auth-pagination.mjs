import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function loadAction(file, { pages, failPage = null } = {}) {
  const calls = [];
  const service = {
    auth: { admin: {
      async listUsers({ page }) {
        calls.push(['list', page]);
        if (page === failPage) return { data: null, error: { message: '後頁暫時無法讀取' } };
        return { data: { users: pages[page - 1] ?? [], nextPage: page < pages.length ? page + 1 : null }, error: null };
      },
      async inviteUserByEmail(email) {
        calls.push(['invite', email]);
        return { data: { user: { id: 'new-user', email } }, error: null };
      },
    } },
    async rpc(name, values) {
      calls.push(['rpc', name, values]);
      return { data: 'new-brand', error: null };
    },
    from(table) {
      return { async upsert(values) {
        calls.push(['upsert', table, values]);
        return { error: null };
      } };
    },
  };
  const dependencies = {
    '@/lib/admin-query': { adminQuery: async value => value, adminErrorMessage: value => String(value) },
    'next/cache': { revalidatePath: value => calls.push(['revalidate', value]) },
    'next/navigation': { redirect: value => calls.push(['redirect', value]) },
    '@/lib/supabase': { createServiceClient: () => service },
    '@/lib/platform': {
      PLATFORM_ADD_ONS: [],
      requireSystemPermission: async () => ({ user: { id: 'system-admin' } }),
      requireSystemAdmin: async () => ({ user: { id: 'system-admin' } }),
    },
    '@/lib/platform-roles': { normalizeSystemPermissions: values => values },
    '@/lib/auth-invite': { authInviteRedirectUrl: () => 'https://staging.example.invalid/auth/accept-invite' },
  };
  const exports = {};
  const source = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => dependencies[name] ?? {}, FormData, Error });
  return { actions: exports, calls };
}

function brandForm() {
  const form = new FormData();
  form.set('name', '隔離測試品牌');
  form.set('slug', 'qa-second-page');
  form.set('owner_email', 'OWNER@example.invalid');
  return form;
}

function adminForm() {
  const form = new FormData();
  form.set('email', 'OWNER@example.invalid');
  form.set('access_type', 'system_admin');
  return form;
}

const brandFile = 'app/admin/platform/actions.ts';
const adminFile = 'app/admin/platform/admins/actions.ts';
const secondPage = [[{ id: 'other', email: 'other@example.invalid' }],
  [{ id: 'existing', email: 'owner@example.invalid' }]];

test('new brand assigns an existing owner after Auth page one without sending an invitation', async () => {
  const { actions, calls } = loadAction(brandFile, { pages: secondPage });
  await actions.createPlatformBrandAction(brandForm());
  assert.deepEqual(calls.filter(([kind]) => kind === 'list').map(([, page]) => page), [1, 2]);
  assert.equal(calls.find(([kind]) => kind === 'rpc')?.[2].p_owner_user_id, 'existing');
  assert.ok(!calls.some(([kind]) => kind === 'invite'));
  assert.equal(calls.find(([kind]) => kind === 'redirect')?.[1], '/admin/platform?section=brands&created=1');
});

test('new brand stops before invite and insert when a later Auth page fails', async () => {
  const { actions, calls } = loadAction(brandFile, { pages: secondPage, failPage: 2 });
  await assert.rejects(actions.createPlatformBrandAction(brandForm()), /後頁暫時無法讀取/);
  assert.deepEqual(calls.filter(([kind]) => kind === 'list').map(([, page]) => page), [1, 2]);
  assert.ok(!calls.some(([kind]) => kind === 'invite' || kind === 'rpc'));
});

test('system staff action reuses an existing account after Auth page one', async () => {
  const { actions, calls } = loadAction(adminFile, { pages: secondPage });
  await actions.upsertPlatformAdminAction(adminForm());
  assert.deepEqual(calls.filter(([kind]) => kind === 'list').map(([, page]) => page), [1, 2]);
  assert.equal(calls.find(([kind]) => kind === 'upsert')?.[2].user_id, 'existing');
  assert.ok(!calls.some(([kind]) => kind === 'invite'));
});

test('system staff action stops before invite and grant when a later Auth page fails', async () => {
  const { actions, calls } = loadAction(adminFile, { pages: secondPage, failPage: 2 });
  await assert.rejects(actions.upsertPlatformAdminAction(adminForm()), /後頁暫時無法讀取/);
  assert.deepEqual(calls.filter(([kind]) => kind === 'list').map(([, page]) => page), [1, 2]);
  assert.ok(!calls.some(([kind]) => kind === 'invite' || kind === 'upsert'));
});
