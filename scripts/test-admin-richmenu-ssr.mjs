import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const clinicId = 'fixture-brand';
const secret = 'Authorization=Bearer private-richmenu-error';

function load(file, deps) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name in deps) return deps[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Promise, Date, Intl, Math, Number, Array, Object, process: { env: {} }, crypto: { randomUUID: () => 'fixture-error-id' }, console: { error() {} },
  });
  return exports;
}

const admin = load('lib/admin-query.ts', { 'server-only': {}, '@/lib/error-category': { errorCategory: () => 'external' } });
const pagination = load('lib/supabase-pagination.ts', { 'server-only': {}, '@/lib/admin-query': admin });

function fixture({ count = 1001, failTable, failFrom = 1000, denied = false, disabled = false, insight = false } = {}) {
  const calls = [];
  let serviceCalls = 0;
  const at = '2026-09-24T00:00:00Z';
  const rows = {
    line_richmenu_versions: Array.from({ length: count }, (_, i) => ({ id: `version-${i}`, clinic_id: clinicId, version_no: count - i,
      name: i === count - 1 ? '第 1001 筆舊版選單' : `版本 ${i}`, template_key: 'mixed', layout: 'full-6', chat_bar_text: '選單', slots: [], status: 'draft',
      line_rich_menu_id: insight && i === 0 ? 'line-menu-0' : null, validation_errors: [], published_at: null, created_at: at, source_version_id: null })),
    line_messages: Array.from({ length: count }, (_, i) => ({ id: `message-${i}`, clinic_id: clinicId, name: i === count - 1 ? '第 1001 筆舊素材' : `素材 ${i}`, created_at: at })),
    line_richmenu_aliases: Array.from({ length: count }, (_, i) => ({ id: `alias-${i}`, clinic_id: clinicId, alias_id: `alias_${i}`, label: i === count - 1 ? '第 1001 筆舊別名' : `別名 ${i}`,
      version_id: `version-${i}`, status: 'ready', last_error: null, last_synced_at: at, updated_at: at })),
    line_richmenu_schedules: Array.from({ length: count }, (_, i) => ({ id: `schedule-${i}`, clinic_id: clinicId, version_id: `version-${i}`,
      starts_at: at, ends_at: at, status: 'completed', attempt_count: 1, last_error: null })),
    funnel_events: insight ? Array.from({ length: count }, (_, i) => ({ id: `funnel-${i}`, clinic_id: clinicId,
      event_name: 'booking_success', source: 'richmenu', metadata: { rm_version: 'version-0', rm_slot: 1 }, created_at: at })) : [],
  };
  if (insight) rows.line_richmenu_versions[0].slots = [{ label: '預約', action: 'booking' }];
  for (const table of Object.keys(rows)) rows[table].push({ ...rows[table][0], id: `foreign-${table}`, clinic_id: 'foreign-brand' });
  function from(table) {
    const call = { table, clinic: null, range: null, limit: null };
    calls.push(call);
    const query = {
      select() { return query; },
      eq(column, value) { if (column === 'clinic_id') call.clinic = value; return query; },
      gte() { return query; }, lt() { return query; },
      order() { return query; },
      range(start, end) { call.range = [start, end]; return query; },
      limit(value) { call.limit = value; return query; },
      maybeSingle() { call.single = true; return query; },
      then(resolve, reject) {
        if (table === failTable && call.range?.[0] === failFrom) return Promise.resolve({ data: null, error: { message: secret } }).then(resolve, reject);
        const data = table === 'clinic_settings'
          ? { public_booking_enabled: true, events_enabled: false, public_registration_enabled: false, memberships_enabled: false, line_channel_enabled: false, legacy_progress_enabled: false }
          : table === 'line_richmenu' ? null
            : (rows[table] ?? []).filter(row => row.clinic_id === call.clinic).slice(call.range?.[0] ?? 0, (call.range?.[1] ?? 999) + 1);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const db = { from };
  const noop = () => {};
  const Page = load('app/admin/richmenu/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase-server': { createSupabaseServer: async () => db },
    '@/lib/admin-query': admin,
    '@/lib/supabase-pagination': pagination,
    '@/lib/delivery-error': { deliveryError: () => '安全錯誤' },
    '@/lib/supabase': { createServiceClient: () => { serviceCalls++; return db; } },
    '@/lib/richmenu': { ACTION_OPTIONS: [], LAYOUTS: { 'full-6': { label: '六格', width: 2500, height: 1686 } },
      richMenuTemplate: () => ({ layout: 'full-6', slots: [] }), richMenuTemplateLabel: () => '通用', slotBounds: () => [{ x: 0, y: 0, width: 100, height: 100 }] },
    '../line-actions': { cancelRichMenuScheduleAction: noop, cloneRichMenuVersionAction: noop, createRichMenuScheduleAction: noop,
      removeRichMenuAliasAction: noop, rollbackRichMenuVersionAction: noop, saveRichMenuAction: noop,
      syncRichMenuAliasAction: noop, unpublishRichMenuAction: noop },
    './RichMenuEditor': { __esModule: true, default: ({ messages }) => React.createElement('div', { 'data-last-message': messages.at(-1)?.name }) },
    './PublishForm': { __esModule: true, default: () => null },
    '@/lib/admin': { requireAdmin: async () => { if (denied) throw new Error('DENIED'); return { clinicId }; } },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => React.createElement('button', null, children) },
    '@/components/ConfirmSubmitButton': { ConfirmSubmitButton: ({ children }) => React.createElement('button', null, children) },
    '@/lib/line': { getRichMenuInsightSummary: async () => ({ impression: { metrics: { count: 100, uniqueUsers: 30 } }, clicks: [] }), lineAccessTokenForDestination: async () => insight ? 'fixture-token' : null },
    '@/lib/admin-modules': { isAdminModuleEnabled: async () => !disabled },
    '@/components/ModuleDisabled': { ModuleDisabled: ({ title }) => React.createElement('div', null, title) },
    '@/lib/line-channel': { getClinicLineChannelContext: async () => {
      if (!insight) throw new Error('No isolated LINE channel');
      return { enabled: true, destination: 'fixture-destination', clinicSlug: 'fixture-brand', liffId: 'fixture-liff', loginChannelId: 'fixture-login', verificationStatus: 'ready' };
    } },
    '@/components/TechnicalDetails': { TechnicalDetails: () => null },
  }).default;
  return { render: async () => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(insight ? { insight_version: 'version-0' } : {}) })), calls, serviceCalls: () => serviceCalls };
}

test('rich menu renders item 1001 from versions, messages, aliases and schedules within tenant', async () => {
  const h = fixture();
  const html = await h.render();
  for (const label of ['第 1001 筆舊版選單', '第 1001 筆舊素材', '第 1001 筆舊別名']) assert(html.includes(label), label);
  assert(h.calls.some(call => call.table === 'line_richmenu_schedules' && call.range?.[0] === 1000));
  assert(h.calls.every(call => call.clinic === clinicId));
  assert(h.calls.filter(call => call.range).every(call => call.limit === null));
  assert(!html.includes('foreign-'));
});

for (const table of ['line_richmenu_versions', 'line_messages', 'line_richmenu_aliases', 'line_richmenu_schedules']) {
  test(`${table} second page failure cannot show partial menu`, async () => {
    const h = fixture({ failTable: table });
    await assert.rejects(h.render(), error => !error.message.includes(secret));
  });
}

test('role rejection and disabled module stop before service-role reads', async () => {
  for (const options of [{ denied: true }, { disabled: true }]) {
    const h = fixture(options);
    if (options.denied) await assert.rejects(h.render(), /DENIED/);
    else assert((await h.render()).includes('Rich Menu'));
    assert.equal(h.serviceCalls(), 0);
  }
});

test('insight conversion includes funnel event 1001 and is scoped to tenant', async () => {
  const h = fixture({ insight: true });
  const html = await h.render();
  assert.match(html, /預約完成<\/th>/);
  assert.match(html, />1001<\/td>/);
  assert(h.calls.some(call => call.table === 'funnel_events' && call.range?.[0] === 1000));
  assert(h.calls.filter(call => call.table === 'funnel_events').every(call => call.clinic === clinicId));
});

test('insight second-page failure shows safe error without partial conversion', async () => {
  const h = fixture({ insight: true, failTable: 'funnel_events' });
  const html = await h.render();
  assert(html.includes('目前無法讀取成效資料'));
  assert(!html.includes(secret));
  assert(!html.includes('>1000</td>'));
});
