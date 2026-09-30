import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadAction(updateResult) {
  const calls = [];
  const refreshed = [];
  const query = {
    update(value) { calls.push(['update', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    select(columns) { calls.push(['select', columns]); return this; },
    maybeSingle() { return Promise.resolve(updateResult); },
  };
  const member = {
    clinicId: 'own-brand',
    supabase: { from(table) { calls.push(['from', table]); return query; } },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/admin/handoff/actions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === '@/lib/admin-query') return {
        adminQuery: value => value,
        adminErrorMessage: () => '目前無法確認操作結果',
      };
      if (name === '@/lib/admin') return { requireOperator: async () => member };
      if (name === 'next/cache') return { revalidatePath: path => refreshed.push(path) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    FormData, Error, Date,
  });
  return { action: exports.updateHandoffTaskAction, calls, refreshed };
}

function form() {
  const fd = new FormData();
  fd.set('id', 'own-task');
  fd.set('status', 'done');
  fd.set('priority', 'high');
  return fd;
}

test('matching persisted completion is confirmed and refreshed', async () => {
  const h = loadAction({ data: { id: 'own-task', status: 'done', priority: 'high' }, error: null });
  await h.action(form());
  assert.deepEqual(h.calls.find(call => call[0] === 'eq' && call[1] === 'clinic_id'), ['eq', 'clinic_id', 'own-brand']);
  assert.deepEqual(h.refreshed, ['/admin/handoff', '/admin/dashboard']);
});

test('zero-row update cannot look successful', async () => {
  const h = loadAction({ data: null, error: null });
  await assert.rejects(h.action(form()), /無法確認交班待辦已更新/);
  assert.deepEqual(h.refreshed, []);
});

test('returned state mismatch cannot look successful', async () => {
  const h = loadAction({ data: { id: 'own-task', status: 'open', priority: 'high' }, error: null });
  await assert.rejects(h.action(form()), /無法確認交班待辦已更新/);
  assert.deepEqual(h.refreshed, []);
});

test('database error remains a safe failure', async () => {
  const h = loadAction({ data: null, error: { message: 'PRIVATE_DB_DETAIL' } });
  await assert.rejects(h.action(form()), error => error.message === '目前無法確認操作結果');
  assert.deepEqual(h.refreshed, []);
});
