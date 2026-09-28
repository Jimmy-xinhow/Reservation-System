import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const clinicId = 'own-brand';
const ownService = { clinic_id: clinicId, name: 'Own service' };
const foreignService = { clinic_id: 'other-brand', name: 'Foreign service secret' };
const appointments = [
  { id: 'own', patient_id: 'patient', doctor_id: null, service_id: 'own-service-id', status: 'booked', services: ownService, doctors: null, patients: { clinic_id: clinicId, name: 'Own patient' } },
  { id: 'mislinked', patient_id: 'patient', doctor_id: null, service_id: 'foreign-service-id', status: 'booked', services: foreignService, doctors: null, patients: { clinic_id: clinicId, name: 'Own patient' } },
];

function load(path, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name === '@/lib/public-relation-scope') return load('lib/public-relation-scope.ts', dependencies);
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Response, Promise, Date, Set,
  });
  return exports;
}

function fixture(route, { enabled = false } = {}) {
  const queries = [];
  const rows = {
    patients: route === 'booking/my' ? [{ id: 'patient' }] : { id: 'patient', name: 'Own patient' },
    appointments,
    appointment_waitlist_entries: [
      { id: 'own-wait', status: 'waiting', services: ownService, doctors: null, patients: { clinic_id: clinicId, name: 'Own patient' } },
      { id: 'foreign-wait', status: 'waiting', services: foreignService, doctors: null, patients: { clinic_id: clinicId, name: 'Own patient' } },
    ],
    registrations: [
      { id: 'own-registration', status: 'confirmed', payment_status: 'paid', checkin_token_encrypted: 'encrypted', events: { clinic_id: clinicId, title: 'Own event' }, event_sessions: { clinic_id: clinicId, name: 'Own session' } },
      { id: 'foreign-registration', status: 'confirmed', payment_status: 'paid', checkin_token_encrypted: 'encrypted', events: { clinic_id: 'other-brand', title: 'Foreign event secret' }, event_sessions: { clinic_id: 'other-brand', name: 'Foreign session secret' } },
    ],
    patient_memberships: [
      { membership_code: 'own-membership', membership_plans: { clinic_id: clinicId, name: 'Own plan' } },
      { membership_code: 'foreign-membership', membership_plans: { clinic_id: 'other-brand', name: 'Foreign plan secret' } },
    ],
  };
  const service = {
    from(table) {
      const queryRecord = { table, selection: '' };
      queries.push(queryRecord);
      const query = new Proxy({}, {
        get(_, key) {
          if (key === 'then') return (resolve, reject) => Promise.resolve({ data: rows[table], error: null }).then(resolve, reject);
          if (key === 'maybeSingle') return () => Promise.resolve({ data: rows[table], error: null });
          return (...args) => {
            if (key === 'select') queryRecord.selection = args[0];
            return query;
          };
        },
      });
      return query;
    },
  };
  const dependencies = {
    '@/lib/membership-redemption': { applyMembershipRedemptionSnapshot: row => row },
    '@/lib/supabase': { createServiceClient: () => service },
    '@/lib/http': {
      rateLimitResponse: async () => null,
      getClinicSettings: async () => ({ events_enabled: enabled, memberships_enabled: enabled, booking_mode: 'time' }),
      ok: data => Response.json({ ok: true, data }),
      fail: (message, status = 400) => Response.json({ ok: false, error: message }, { status }),
    },
    '@/lib/public-brand': { resolvePublicClinicId: async () => clinicId },
    '@/lib/browser-booking': { verifyBrowserBookingToken: () => ({ clinicId, patientId: 'patient' }), createBrowserBookingToken: () => 'scoped-token' },
    '@/lib/line-channel': { verifyClinicLiffIdToken: async () => ({ sub: 'line-user' }) },
    '@/lib/registration-credentials': { decryptRegistrationToken: () => null },
    '@/lib/queue': { taipeiToday: () => '2026-09-28', getPatientQueueToday: async () => [] },
    '@/lib/legacy-progress': { isLegacyProgressEnabled: async () => false },
  };
  const POST = load(`app/api/${route}/route.ts`, dependencies).POST;
  const request = { json: async () => ({ browser_token: 'valid', idToken: 'valid' }), nextUrl: new URL('https://example.test/?clinic_slug=own') };
  return { queries, run: async () => ({ response: await POST(request), queries }) };
}

for (const route of ['customer/portal', 'booking/browser/my', 'booking/my']) {
  test(`${route} keeps own appointment but masks cross-brand joined service`, async () => {
    const { response, queries } = await fixture(route).run();
    assert.equal(response.status, 200);
    const result = await response.json();
    const own = result.data.appointments.find(row => row.id === 'own');
    const mislinked = result.data.appointments.find(row => row.id === 'mislinked');
    assert.equal(own?.services?.name, 'Own service');
    assert.equal(mislinked?.services, null);
    assert(!JSON.stringify(result).includes('Foreign service secret'));
    if (route !== 'customer/portal') assert.equal(mislinked?.service_id, null);
    assert(queries.find(query => query.table === 'appointments')?.selection.includes('services(clinic_id,name)'));
  });
}

for (const route of ['booking/browser/my', 'booking/my']) {
  test(`${route} masks cross-brand waitlist label`, async () => {
    const { response, queries } = await fixture(route).run();
    const result = await response.json();
    assert.equal(result.data.waitlists.find(row => row.id === 'own-wait')?.services?.name, 'Own service');
    assert.equal(result.data.waitlists.find(row => row.id === 'foreign-wait')?.services, null);
    assert(!JSON.stringify(result).includes('Foreign service secret'));
    assert(queries.find(query => query.table === 'appointment_waitlist_entries')?.selection.includes('services(clinic_id,name)'));
  });
}

test('customer portal masks cross-brand registration and membership labels', async () => {
  const { response, queries } = await fixture('customer/portal', { enabled: true }).run();
  const result = await response.json();
  assert.equal(result.data.registrations.find(row => row.id === 'own-registration')?.events?.title, 'Own event');
  assert.equal(result.data.registrations.find(row => row.id === 'foreign-registration')?.events, null);
  assert.equal(result.data.registrations.find(row => row.id === 'foreign-registration')?.event_sessions, null);
  assert.equal(result.data.memberships.find(row => row.membership_code === 'own-membership')?.membership_plans?.name, 'Own plan');
  assert.equal(result.data.memberships.find(row => row.membership_code === 'foreign-membership')?.membership_plans, null);
  assert(!JSON.stringify(result).includes('Foreign event secret'));
  assert(!JSON.stringify(result).includes('Foreign session secret'));
  assert(!JSON.stringify(result).includes('Foreign plan secret'));
  for (const table of ['registrations', 'patient_memberships']) {
    assert(queries.find(query => query.table === table)?.selection.includes('clinic_id,'));
  }
});
