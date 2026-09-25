import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const brand = 'fixture-brand';
const privateError = 'PRIVATE_HANDOFF_DETAIL Authorization=Bearer secret-token';

function load(file, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Date, Intl, URLSearchParams,
  });
  return exports;
}

const errorCategory = load('lib/error-category.ts', {});
const adminQuery = load('lib/admin-query.ts', { 'server-only': {}, '@/lib/error-category': errorCategory });
const pagination = load('lib/supabase-pagination.ts', { 'server-only': {}, '@/lib/admin-query': adminQuery });
const accountSummaries = load('lib/admin-account-summaries.ts', { 'server-only': {}, '@/lib/admin-query': adminQuery });
const link = ({ href, children }) => React.createElement('a', { href }, children);

function fixture({ taskCount = 2, memberCount = 2, failure = null, denied = false } = {}) {
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `task-${String(index).padStart(4, '0')}`, clinic_id: brand,
    title: index === 1000 ? '最後一筆交班' : `交班 ${index}`,
    category: 'appointment', status: 'open', priority: 'normal',
    due_at: null, assigned_to: null, note: null, created_at: '2026-09-23T00:00:00Z',
  }));
  tasks.push({ ...tasks[0], id: 'foreign-task', clinic_id: 'other-brand', title: '外品牌交班' });
  const members = Array.from({ length: memberCount }, (_, index) => ({
    user_id: `member-${String(index).padStart(4, '0')}`, clinic_id: brand, access_type: 'employee',
  }));
  members.push({ ...members[0], user_id: 'foreign-member', clinic_id: 'other-brand' });
  const calls = [], ids = [];
  function from(table) {
    const call = { table, filters: [], orders: [], range: null };
    calls.push(call);
    const query = {
      select() { return query; },
      eq(column, value) { call.filters.push([column, value]); return query; },
      order(column, options) { call.orders.push([column, options?.ascending !== false]); return query; },
      range(fromIndex, toIndex) { call.range = [fromIndex, toIndex]; return query; },
      then(resolve, reject) {
        if (failure?.table === table && failure.from === call.range?.[0]) {
          if (failure.mode === 'throw') return Promise.reject(new Error(privateError)).then(resolve, reject);
          return Promise.resolve({ data: failure.mode === 'null' ? null : [], error: failure.mode === 'error' ? { message: privateError } : null }).then(resolve, reject);
        }
        let rows = table === 'handoff_tasks' ? tasks : members;
        for (const [column, value] of call.filters) rows = rows.filter(row => row[column] === value);
        for (const [column, ascending] of [...call.orders].reverse()) {
          rows = [...rows].sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (ascending ? 1 : -1));
        }
        return Promise.resolve({ data: call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows, error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const service = {
    from,
    auth: { admin: {
      listUsers() { throw new Error('Global Auth enumeration forbidden'); },
      getUserById: async id => {
        ids.push(id);
        if (failure?.table === 'auth') {
          if (failure.mode === 'throw') throw new Error(privateError);
          return { data: failure.mode === 'mismatch' ? { user: { id: 'other-user', email: 'foreign@example.invalid' } } : null, error: failure.mode === 'error' ? { message: privateError } : null };
        }
        return { data: { user: { id, email: id === 'member-1000' ? 'last-member@example.invalid' : `${id}@example.invalid` } }, error: null };
      },
    } },
  };
  const member = { clinicId: brand, supabase: { from } };
  const page = load('app/admin/handoff/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: link },
    '@/lib/admin-query': adminQuery,
    '@/lib/admin': { requireNonProvider: async () => {
      if (denied) throw new Error('NEXT_REDIRECT');
      return member;
    } },
    '@/lib/supabase': { createServiceClient: () => service },
    '@/lib/supabase-pagination': pagination,
    '@/lib/admin-account-summaries': accountSummaries,
    '@/components/SubmitButton': { SubmitButton: ({ children }) => React.createElement('button', null, children) },
    './actions': { createHandoffTaskAction: () => {}, updateHandoffTaskAction: () => {} },
  });
  return { calls, ids, render: async (params = {}) => renderToStaticMarkup(await page.default({ searchParams: Promise.resolve(params) })) };
}

test('handoff renders task 1001 with scoped rows and accurate counts', async () => {
  const h = fixture({ taskCount: 1001 });
  const html = await h.render();
  assert.match(html, /最後一筆交班/);
  assert.match(html, /目前清單<\/span><strong[^>]*>1001/);
  assert(!html.includes('外品牌交班'));
  assert(h.calls.some(call => call.table === 'handoff_tasks' && call.range?.[0] === 1000));
  assert(h.calls.every(call => call.filters.some(([column, value]) => column === 'clinic_id' && value === brand)));
});

test('handoff resolves member 1001 without enumerating global Auth or showing foreign member', async () => {
  const h = fixture({ taskCount: 0, memberCount: 1001 });
  const html = await h.render();
  assert.match(html, /last-member@example\.invalid/);
  assert(!html.includes('foreign-member'));
  assert.equal(h.ids.length, 1001);
  assert(h.calls.some(call => call.table === 'clinic_members' && call.range?.[0] === 1000));
});

for (const table of ['handoff_tasks', 'clinic_members']) {
  for (const mode of ['error', 'throw', 'null']) {
    test(`${table} second page ${mode} fails closed`, async () => {
      const h = fixture({ taskCount: 1001, memberCount: 1001, failure: { table, from: 1000, mode } });
      await assert.rejects(h.render(), error => error.message.includes('目前無法確認操作結果') && !error.message.includes('secret-token'));
      assert.equal(h.ids.length, 0);
    });
  }
}

for (const mode of ['error', 'throw', 'mismatch']) {
  test(`Auth ${mode} fails closed without raw provider detail`, async () => {
    const h = fixture({ failure: { table: 'auth', mode } });
    await assert.rejects(h.render(), error => error.message.includes('目前無法確認') && !error.message.includes('secret-token'));
  });
}

test('unauthorized role stops before tenant or service reads', async () => {
  const h = fixture({ denied: true });
  await assert.rejects(h.render(), /NEXT_REDIRECT/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.ids.length, 0);
});
