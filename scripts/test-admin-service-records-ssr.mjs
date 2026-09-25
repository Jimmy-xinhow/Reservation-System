import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function fixture({ photoMode = 'ok', denied = false, crossTenantRecord = false } = {}) {
  const calls = [];
  let serviceCalls = 0;
  const appointments = Array.from({ length: 35 }, (_, index) => ({
    id: `appointment-${index}`, clinic_id: 'fixture-brand', patient_id: `patient-${index}`, start_at: new Date(Date.UTC(2026, 8, 30, 0, 0) - index * 86400000).toISOString(),
    status: 'booked', patients: { id: `patient-${index}`, clinic_id: 'fixture-brand', name: index === 34 ? '超過近期清單的顧客' : `近期顧客${index}` }, services: { name: '服務' },
  }));
  appointments.push({ ...appointments[0], id: 'foreign-appointment', clinic_id: 'foreign-brand', patients: { id: 'patient-0', clinic_id: 'foreign-brand', name: '外品牌顧客' } });
  const record = { id: 'record-1', clinic_id: 'fixture-brand', patient_id: 'patient-0', appointment_id: 'appointment-0', registration_id: null,
    treatment_name: '服務紀錄', assessment: null, content: '內容', aftercare: null,
    private_photo_paths: ['fixture-brand/appointment-0/photo.jpg'], created_at: '2026-09-24T00:00:00Z',
    patients: appointments[0].patients, appointments: appointments[0], registrations: null };
  const rows = {
    appointments,
    registrations: [],
    patient_records: [record, ...(crossTenantRecord ? [{ ...record, id: 'foreign-record', patient_id: 'foreign-patient',
      content: '外品牌紀錄內容', private_photo_paths: ['foreign-brand/private.jpg'],
      patients: { id: 'foreign-patient', clinic_id: 'foreign-brand', name: '外品牌顧客姓名' } }] : [])],
    clinic_settings: [{ clinic_id: 'fixture-brand', dashboard_focus: 'booking' }],
  };
  function from(table) {
    const call = { table, clinic: null, limit: null };
    calls.push(call);
    const query = {
      select() { return query; },
      eq(column, value) { if (column === 'clinic_id') call.clinic = value; return query; },
      neq() { return query; }, not() { return query; }, in() { return query; }, order() { return query; },
      limit(value) { call.limit = value; return query; },
      maybeSingle() { call.single = true; return query; },
      then(resolve, reject) {
        const data = rows[table].filter(row => row.clinic_id === call.clinic).slice(0, call.limit ?? Infinity);
        return Promise.resolve({ data: call.single ? data[0] ?? null : data, error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const service = {
    from,
    storage: { from: () => ({ createSignedUrls: async paths => photoMode === 'error'
      ? { data: null, error: { message: 'private provider detail' } }
      : { data: photoMode === 'incomplete' ? [] : paths.map(path => ({ path, signedUrl: 'https://example.test/private-photo' })), error: null } }) },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/admin/operations/service-records/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => ({
      'react/jsx-runtime': jsx,
      '@/lib/admin-query': { adminQuery: query => query, adminErrorMessage: () => '安全錯誤' },
      '@/lib/admin': { requireNonProvider: async () => { if (denied) throw new Error('DENIED'); return { clinicId: 'fixture-brand' }; } },
      '@/lib/slots': { formatDateTime: date => date },
      '@/lib/supabase': { createServiceClient: () => { serviceCalls++; return service; } },
      '../../beauty/actions': { createTreatmentRecordAction: () => {} },
      '../../beauty/TreatmentRecordForm': { TreatmentRecordForm: ({ sources }) => React.createElement('div', { 'data-source-count': sources.length }, sources.map(row => row.label).join('|')) },
    })[name] ?? (() => { throw new Error(`Unexpected dependency: ${name}`); })(),
  });
  return { render: async () => renderToStaticMarkup(await exports.default()), calls, serviceCalls: () => serviceCalls };
}

test('recent options stay bounded and scoped without silently including older or foreign sources', async () => {
  const h = fixture();
  const html = await h.render();
  assert.match(html, /data-source-count="30"/);
  assert(!html.includes('超過近期清單的顧客'));
  assert(!html.includes('外品牌顧客'));
  assert(h.calls.every(call => call.clinic === 'fixture-brand'));
});

test('foreign patient link is hidden before the private photo is signed', async () => {
  const h = fixture({ crossTenantRecord: true });
  const html = await h.render();
  assert(!html.includes('外品牌顧客姓名'));
  assert(!html.includes('外品牌紀錄內容'));
  assert.match(html, /最近 1 筆服務／課程紀錄/);
});

for (const photoMode of ['error', 'incomplete']) {
  test(`private photo signing ${photoMode} fails closed`, async () => {
    const h = fixture({ photoMode });
    await assert.rejects(h.render(), error => error.message === '安全錯誤');
  });
}

test('denied operator does not create a service client', async () => {
  const h = fixture({ denied: true });
  await assert.rejects(h.render(), /DENIED/);
  assert.equal(h.serviceCalls(), 0);
});
