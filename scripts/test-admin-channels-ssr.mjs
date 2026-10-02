import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'channels-brand';
const privateError = 'PRIVATE_CHANNEL_DB_SECRET';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name in deps) return deps[name];
    throw Error(`Unexpected dependency: ${name}`);
  }, Date, Intl });
  return exports;
}

function fixture({ deny = false, failChannel = '', reject = false } = {}) {
  const calls = [];
  const runs = Array.from({ length: 150 }, (_, i) => ({ id: `line-${i}`, clinic_id: clinicId, channel: 'line', status: 'warning', checks: [], created_at: `2026-09-23T12:${String(i % 60).padStart(2, '0')}:00Z` }));
  runs.push({ id: 'email-old', clinic_id: clinicId, channel: 'email', status: 'passed', checks: [{ label: '寄件設定', status: 'passed', detail: '已設定' }], created_at: '2026-09-01T10:00:00Z' });
  runs.push({ id: 'foreign-email', clinic_id: 'foreign-brand', channel: 'email', status: 'failed', checks: [], created_at: '2026-09-23T14:00:00Z' });
  const client = { from(table) {
    assert.equal(table, 'channel_test_runs');
    const call = { table, filters: [], orders: [], limit: null, projection: '' };
    calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, rejectPromise) => {
        const channel = call.filters.find(([column]) => column === 'channel')?.[1];
        if (channel === failChannel && reject) return Promise.reject(Error(privateError)).then(resolve, rejectPromise);
        if (channel === failChannel) return Promise.resolve({ data: null, error: { message: privateError } }).then(resolve, rejectPromise);
        let data = runs.filter(row => call.filters.every(([column, value]) => row[column] === value));
        data = data.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        return Promise.resolve({ data: data.slice(0, call.limit ?? 1000), error: null }).then(resolve, rejectPromise);
      };
      return (...args) => {
        if (key === 'select') call.projection = args[0];
        if (key === 'eq') call.filters.push(args);
        if (key === 'order') call.orders.push(args[0]);
        if (key === 'limit') call.limit = args[0];
        return query;
      };
    } });
    return query;
  } };
  const page = load('app/admin/channels/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, href }) => jsx.jsx('a', { href, children }) },
    '@/lib/admin': { requireAdmin: async () => { if (deny) throw Error('DENIED'); return { clinicId }; } },
    '@/lib/supabase': { createServiceClient: () => client },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => jsx.jsx('button', { children }) },
    './actions': { runChannelTestsAction: () => {} },
  });
  return { page, calls };
}

test('each channel uses its latest scoped run even if it falls outside the former global top 100', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.page.default({ searchParams: Promise.resolve({}) }));
  assert.match(html, /寄件設定/);
  assert.match(html, /已設定/);
  assert.ok(!html.includes('PRIVATE_CHANNEL_DB_SECRET'));
  assert.equal(f.calls.length, 5);
  for (const call of f.calls) {
    assert.equal(call.limit, 1);
    assert.deepEqual(call.orders, ['created_at', 'id']);
    assert.ok(call.filters.some(([column, value]) => column === 'clinic_id' && value === clinicId));
    assert.ok(call.filters.some(([column]) => column === 'channel'));
  }
});

for (const reject of [false, true]) {
  test(`channel status fails closed on ${reject ? 'rejected' : 'returned'} error`, async () => {
    const f = fixture({ failChannel: 'email', reject });
    await assert.rejects(() => f.page.default({ searchParams: Promise.resolve({}) }), error => error.message === '讀取渠道測試失敗，請重新整理後再試' && !error.message.includes(privateError));
  });
}

test('unauthorized role does not query channel history', async () => {
  const f = fixture({ deny: true });
  await assert.rejects(() => f.page.default({ searchParams: Promise.resolve({}) }), /DENIED/);
  assert.equal(f.calls.length, 0);
});
