import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function extract(path, name, dependencies) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert(declaration, name);
  const body = `export function factory(deps) { const {${Object.keys(dependencies).join(',')}}=deps; ${declaration.getText(source).replace(/^export /, '')}; return ${name}; }`;
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return (await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))).factory(dependencies);
}

for (const domain of ['appointment', 'registration']) {
  const path = `lib/${domain}-notifications.ts`;
  for (const channel of ['line', 'email']) {
    for (const failure of ['none', 'provider', 'write', 'lost_ack', 'pre_send']) {
      test(`${domain}/${channel}: ${failure} cannot turn uncertain delivery into retryable failure`, async () => {
        let state = 'sending';
        const writes = [], logs = [], sends = [];
        const row = { id: 'item', clinic_id: 'brand', status: 'confirmed', name: 'Synthetic', clinic_name: 'Synthetic', start_at: new Date().toISOString(), email_enabled: channel === 'email', email: channel === 'email' ? 'synthetic@example.invalid' : null, line_user_id: channel === 'line' ? 'synthetic' : null, patient_email: channel === 'email' ? 'synthetic@example.invalid' : null, patient_line_user_id: channel === 'line' ? 'synthetic' : null };
        const svc = { from: table => {
          const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'registrations' ? row : table === 'clinic_settings' ? { email_enabled: channel === 'email' } : {}, error: null }) };
          return q;
        } };
        const send = async () => { sends.push(channel); if (failure === 'provider') throw Error('secret private-provider-response'); };
        const fn = await extract(path, domain === 'appointment' ? 'notifyAppointmentStatus' : 'notifyRegistrationStatus', {
          loadAppointment: async () => row, claimNotification: async () => 'claim',
          finishNotification: async (_svc, _id, status) => {
            writes.push(status);
            if (failure === 'write') throw Error('secret database-response');
            state = status;
            if (failure === 'lost_ack') throw Error('secret lost-ack');
          },
          recordSkippedNotification: async () => {}, buildMessage: () => ({ subject: 'test', html: 'test' }),
          getClinicLineChannelContext: async () => { if (failure === 'pre_send') throw Error('secret config-error'); return {}; },
          lineAccessTokenForDestination: async () => 'test', customerEntryUrl: () => '/',
          pushMessages: send, sendEmail: send, emailConfigForClinic: async () => ({}),
          buildAppointmentStatusFlex: () => ({}), buildRegistrationStatusFlex: () => ({}),
          lineFlexDesignForDelivery: () => ({}), formatAppointmentDate: () => '', formatEventDate: () => '', formatAmount: () => '',
          publicRegistrationPaymentUrl: () => '/', decryptRegistrationToken: () => null,
          deliveryError: () => 'delivery_error:internal', console: { error: (...args) => logs.push(args) }, process: { env: {} },
        });
        const result = await fn(svc, 'item', 'confirmed');
        if (failure === 'none' || (failure === 'pre_send' && channel === 'email')) {
          assert.equal(result.sent, 1); assert.equal(state, 'sent');
        } else if (failure === 'pre_send') {
          assert.equal(state, 'failed'); assert.equal(sends.length, 0); assert.deepEqual(writes, ['failed']);
        } else {
          assert.equal(result.failed, 1); assert.equal(result.sent, 0); assert.equal(sends.length, 1);
          assert.equal(state, failure === 'lost_ack' ? 'sent' : 'sending');
          assert(!writes.includes('failed'));
        }
        assert(!JSON.stringify(logs).includes('secret'));
      });
    }
  }
  for (const status of ['sending', 'sent', 'failed', 'skipped', 'invalid']) {
    for (const age of ['recent', 'old']) {
      test(`${domain}: ${age} ${status} claim observes uncertainty barrier`, async () => {
        const updates = [];
        let phase = 'read';
        const q = { insert: () => { phase = 'insert'; return q; }, select: () => q, eq: () => q, update: value => { updates.push(value); phase = 'update'; return q; }, maybeSingle: async () => phase === 'insert' ? { data: null, error: { code: '23505' } } : phase === 'read' ? { data: { id: 'claim', status, attempt_count: 1, updated_at: age === 'old' ? '2000-01-01T00:00:00Z' : new Date().toISOString() }, error: null } : { data: { id: 'claim' }, error: null } };
        const svc = { from: () => { phase = 'read'; return q; } };
        const fn = await extract(path, 'claimNotification', {});
        const call = () => domain === 'appointment' ? fn(svc, { id: 'item', clinic_id: 'brand' }, 'confirmed', 'email') : fn(svc, 'brand', 'item', 'confirmed', 'email');
        if (status === 'sending' || status === 'invalid') { await assert.rejects(call, /notification_delivery_/); assert.equal(updates.length, 0); }
        else if (status === 'sent') { assert.equal(await call(), null); assert.equal(updates.length, 0); }
        else { assert.equal(await call(), 'claim'); assert.equal(updates.length, 1); }
      });
    }
  }
}
