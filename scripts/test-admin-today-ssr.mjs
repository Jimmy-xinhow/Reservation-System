import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const brand = 'fixture-brand';
const appointmentDate = '2026-09-24';
const privateError = 'PRIVATE_TODAY_DETAIL Authorization=Bearer secret-token';

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

function fixture({ appointments = 2, waitlist = 2, doctors = 2, failure, role = 'owner', denied = false } = {}) {
  const rows = {
    clinic_settings: [{ clinic_id: brand, booking_mode: 'time' }],
    doctors: Array.from({ length: doctors }, (_, i) => ({ id: `doctor-${String(i).padStart(4, '0')}`, clinic_id: brand, active: true, name: `員工 ${i}` })),
    appointments: Array.from({ length: appointments }, (_, i) => ({
      id: `appointment-${String(i).padStart(4, '0')}`, clinic_id: brand,
      start_at: '2026-09-24T02:00:00.000Z', queue_number: i + 1, visit_type: 'return',
      status: 'booked', deposit_status: 'none', deposit_amount: 0,
      doctor_id: 'doctor-0000', service_id: 'service-1', doctors: { name: '員工 0' },
      patients: { name: i === 1000 ? '第 1001 位預約顧客' : `預約顧客 ${i}`, phone: '0912345678' },
      services: { name: '服務' },
    })),
    appointment_waitlist_entries: Array.from({ length: waitlist }, (_, i) => ({
      id: `waitlist-${String(i).padStart(4, '0')}`, clinic_id: brand, appointment_id: null,
      requested_date: appointmentDate, requested_start_at: null, position: i + 1,
      status: 'waiting', offer_expires_at: null, doctors: null,
      patients: { name: i === 1000 ? '第 1001 位候補顧客' : `候補顧客 ${i}`, phone: '0912345678' },
      services: { name: '服務' },
    })),
  };
  for (const [table, data] of Object.entries(rows)) {
    rows[table] = [...data, { ...data[0], id: `foreign-${table}`, clinic_id: 'foreign-brand', patients: { name: '外品牌顧客', phone: '0999999999' } }];
  }
  const calls = [];
  function from(table) {
    const call = { table, filters: [], orders: [], range: null };
    calls.push(call);
    const query = {
      select() { return query; },
      eq(column, value) { call.filters.push(['eq', column, value]); return query; },
      gte(column, value) { call.filters.push(['gte', column, value]); return query; },
      lte(column, value) { call.filters.push(['lte', column, value]); return query; },
      in(column, values) { call.filters.push(['in', column, values]); return query; },
      order(column, options) { call.orders.push([column, options?.ascending !== false]); return query; },
      range(fromIndex, toIndex) { call.range = [fromIndex, toIndex]; return query; },
      maybeSingle() { return query; },
      then(resolve, reject) {
        if (failure?.table === table && (failure.from === undefined || failure.from === call.range?.[0])) {
          if (failure.mode === 'throw') return Promise.reject(new Error(privateError)).then(resolve, reject);
          return Promise.resolve({ data: failure.mode === 'null' ? null : [], error: failure.mode === 'error' ? { message: privateError } : null }).then(resolve, reject);
        }
        let result = rows[table] ?? [];
        for (const [operator, column, value] of call.filters) {
          result = result.filter(row => operator === 'eq' ? row[column] === value
            : operator === 'gte' ? row[column] >= value
              : operator === 'lte' ? row[column] <= value
                : value.includes(row[column]));
        }
        for (const [column, ascending] of [...call.orders].reverse()) {
          result = [...result].sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (ascending ? 1 : -1));
        }
        const data = table === 'clinic_settings' ? result[0] ?? null
          : call.range ? result.slice(call.range[0], call.range[1] + 1) : result;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const member = denied ? null : { clinicId: brand, role, supabase: { from } };
  const page = load('app/admin/page.tsx', {
    'react/jsx-runtime': jsx,
    '@/lib/supabase': { createServiceClient: () => ({ from }) },
    '@/lib/admin-query': adminQuery,
    '@/lib/supabase-pagination': pagination,
    '@/lib/admin': {
      getOptionalMember: async () => member,
      getAssignedDoctorIds: async () => ['doctor-0000'],
      canOperate: () => true,
      canViewSensitiveCustomerData: () => role !== 'provider',
    },
    '@/lib/platform': { getOptionalPlatformAdmin: async () => null },
    'next/navigation': { redirect: () => { throw new Error('NEXT_REDIRECT'); } },
    '@/lib/slots': { formatTime: () => '10:00' },
    './appointment-actions': { setStatusAction() {}, cancelAppointmentAction() {}, setDepositAction() {}, cancelAppointmentWaitlistAction() {} },
    '@/components/SubmitButton': { SubmitButton: ({ children }) => React.createElement('button', null, children) },
    './_components/AppointmentDateToolbar': { AppointmentDateToolbar: ({ count }) => React.createElement('div', { 'data-count': count }) },
    './appointments/AppointmentEditor': { default: () => React.createElement('div', null, 'editor') },
  });
  return {
    calls,
    render: async () => renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ date: appointmentDate }) })),
  };
}

test('today page renders appointment 1001 and keeps every query scoped', async () => {
  const h = fixture({ appointments: 1001 });
  const html = await h.render();
  assert.match(html, /第 1001 位預約顧客/);
  assert.match(html, /data-count="1001"/);
  assert(!html.includes('外品牌顧客'));
  assert(h.calls.some(call => call.table === 'appointments' && call.range?.[0] === 1000));
  assert(h.calls.every(call => call.filters.some(([operator, column, value]) => operator === 'eq' && column === 'clinic_id' && value === brand)));
});

test('today page renders waitlist 1001 and doctor 1001', async () => {
  const h = fixture({ appointments: 0, waitlist: 1001, doctors: 1001 });
  const html = await h.render();
  assert.match(html, /第 1001 位候補顧客/);
  assert(h.calls.some(call => call.table === 'appointment_waitlist_entries' && call.range?.[0] === 1000));
  assert(h.calls.some(call => call.table === 'doctors' && call.range?.[0] === 1000));
});

for (const table of ['appointments', 'appointment_waitlist_entries', 'doctors']) {
  for (const mode of ['error', 'throw', 'null']) {
    test(`${table} second page ${mode} fails closed`, async () => {
      const h = fixture({ appointments: 1001, waitlist: 1001, doctors: 1001, failure: { table, from: 1000, mode } });
      await assert.rejects(h.render(), error => !error.message.includes('secret-token'));
    });
  }
}

test('settings returned error fails closed', async () => {
  const h = fixture({ failure: { table: 'clinic_settings', mode: 'error' } });
  await assert.rejects(h.render(), error => error.message.includes('目前無法確認') && !error.message.includes('secret-token'));
});

test('provider sees assigned work without candidate waitlist query or full phone', async () => {
  const h = fixture({ role: 'provider' });
  const html = await h.render();
  assert.match(html, /預約顧客 0/);
  assert(!html.includes('0912345678'));
  assert(!h.calls.some(call => call.table === 'appointment_waitlist_entries'));
  assert(h.calls.filter(call => call.table === 'appointments').every(call => call.filters.some(([operator, column, values]) => operator === 'in' && column === 'doctor_id' && values.includes('doctor-0000'))));
});

test('unauthorized session stops before tenant reads', async () => {
  const h = fixture({ denied: true });
  await assert.rejects(h.render(), /NEXT_REDIRECT/);
  assert.equal(h.calls.length, 0);
});
