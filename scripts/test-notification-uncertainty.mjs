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

test('appointment Email sent state stores the provider receipt, while failures do not invent one', async () => {
  const writes = [];
  const svc = { from: table => {
    assert.equal(table, 'appointment_notification_logs');
    return { update: value => {
      writes.push(value);
      return { eq: async () => ({ error: null }) };
    } };
  } };
  const finish = await extract('lib/appointment-notifications.ts', 'finishNotification', { deliveryError: () => 'delivery_error:internal' });
  const receiptId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  await finish(svc, 'claim', 'sent', undefined, receiptId);
  assert.equal(writes[0].status, 'sent');
  assert.equal(writes[0].provider_message_id, receiptId);
  assert(writes[0].sent_at);
  await finish(svc, 'claim', 'failed', 'provider rejected');
  assert.equal(writes[1].status, 'failed');
  assert.equal(writes[1].provider_message_id, undefined);
  assert.equal(writes[1].sent_at, null);
});

test('reviewed obsolete appointment failure is never claimed for another send', async () => {
  let updates = 0;
  let reads = 0;
  const query = {
    insert: () => query, select: () => query, eq: () => query,
    update: () => { updates++; return query; },
    maybeSingle: async () => reads++ === 0
      ? { data: null, error: { code: '23505' } }
      : { data: { id: 'old', status: 'failed', reviewed_at: '2026-10-03T00:00:00Z', attempt_count: 1 }, error: null },
  };
  const claim = await extract('lib/appointment-notifications.ts', 'claimNotification', {});
  assert.equal(await claim({ from: () => query }, { id: 'appointment', clinic_id: 'brand' }, 'pending', 'line'), null);
  assert.equal(updates, 0);
});

for (const domain of ['appointment', 'registration']) {
  const path = `lib/${domain}-notifications.ts`;
  for (const channel of ['line', 'email']) {
    for (const failure of ['none', 'provider', 'write', 'lost_ack', 'pre_send', ...(channel === 'email' ? ['rejected', ...(domain === 'appointment' ? ['missing_receipt'] : [])] : [])]) {
      test(`${domain}/${channel}: ${failure} cannot turn uncertain delivery into retryable failure`, async () => {
        let state = 'sending';
        const writes = [], logs = [], sends = [];
        const attemptCount = failure === 'rejected' ? 2 : 1;
        const receiptId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const row = { id: 'item', clinic_id: 'brand', patient_id: 'patient', status: 'confirmed', name: 'Synthetic', clinic_name: 'Synthetic', start_at: new Date().toISOString(), email_enabled: channel === 'email', line_channel_enabled: channel === 'line', email: channel === 'email' ? 'synthetic@example.invalid' : null, line_user_id: channel === 'line' ? 'synthetic' : null, patient_email: channel === 'email' ? 'synthetic@example.invalid' : null, patient_line_user_id: channel === 'line' ? 'synthetic' : null };
        const svc = { from: table => {
          const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'registrations' ? row : table === 'clinic_settings' ? { email_enabled: channel === 'email', line_channel_enabled: channel === 'line' } : {}, error: null }) };
          return q;
        } };
        const send = async (...args) => { sends.push(args); if (failure === 'provider') throw Error('secret private-provider-response'); if (failure === 'rejected') throw Error('delivery_error:provider_rejected'); return channel === 'email' && failure !== 'missing_receipt' ? receiptId : null; };
        const fn = await extract(path, domain === 'appointment' ? 'notifyAppointmentStatus' : 'notifyRegistrationStatus', {
          loadAppointment: async () => row, claimNotification: async () => domain === 'appointment' ? { id: 'claim', attemptCount } : 'claim',
          finishNotification: async (_svc, _id, status, _error, providerMessageId) => {
            writes.push(status);
            if (domain === 'appointment' && channel === 'email' && status === 'sent') assert.equal(providerMessageId, receiptId);
            if (failure === 'write') throw Error('secret database-response');
            state = status;
            if (failure === 'lost_ack') throw Error('secret lost-ack');
          },
          recordSkippedNotification: async () => {}, buildMessage: () => ({ subject: 'test', html: 'test' }),
          getClinicLineChannelContext: async () => { if (failure === 'pre_send') throw Error('secret config-error'); return {}; },
          isVerifiedLineRecipient: async () => true,
          lineAccessTokenForDestination: async () => 'test', customerEntryUrl: () => '/',
          pushMessages: send, sendEmail: send, isEmailProviderRejected: error => error?.message === 'delivery_error:provider_rejected', emailConfigForClinic: async () => ({}),
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
        } else if (failure === 'rejected') {
          assert.equal(result.failed, 1); assert.equal(state, 'failed'); assert.equal(sends.length, 1); assert.deepEqual(writes, ['failed']);
        } else {
          assert.equal(result.failed, 1); assert.equal(result.sent, 0); assert.equal(sends.length, 1);
          assert.equal(state, failure === 'lost_ack' ? 'sent' : 'sending');
          assert(!writes.includes('failed'));
        }
        if (domain === 'appointment' && channel === 'email' && sends.length > 0) {
          assert.equal(sends[0].at(-1).idempotencyKey, `appointment-notification-email-claim-${attemptCount}`);
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
        const q = { insert: () => { phase = 'insert'; return q; }, select: () => q, eq: () => q, update: value => { updates.push(value); phase = 'update'; return q; }, maybeSingle: async () => phase === 'insert' ? { data: null, error: { code: '23505' } } : phase === 'read' ? { data: { id: 'claim', status, attempt_count: 1, updated_at: age === 'old' ? '2000-01-01T00:00:00Z' : new Date().toISOString() }, error: null } : { data: { id: 'claim', attempt_count: 2 }, error: null } };
        const svc = { from: () => { phase = 'read'; return q; } };
        const fn = await extract(path, 'claimNotification', {});
        const call = () => domain === 'appointment' ? fn(svc, { id: 'item', clinic_id: 'brand' }, 'confirmed', 'email') : fn(svc, 'brand', 'item', 'confirmed', 'email');
        if (status === 'sending' || status === 'invalid') { await assert.rejects(call, /notification_delivery_/); assert.equal(updates.length, 0); }
        else if (status === 'sent') { assert.equal(await call(), null); assert.equal(updates.length, 0); }
        else { assert.deepEqual(await call(), domain === 'appointment' ? { id: 'claim', attemptCount: 2 } : 'claim'); assert.equal(updates.length, 1); }
      });
    }
  }
}

for (const domain of ['appointment', 'registration']) {
  test(`${domain}: unverified LINE recipient is rejected before provider call`, async () => {
    const writes = [], sends = [];
    const row = { id: 'item', clinic_id: 'brand', patient_id: 'patient', status: 'confirmed',
      name: 'Synthetic', clinic_name: 'Synthetic', line_channel_enabled: true, email_enabled: false,
      line_user_id: 'forged-line', patient_line_user_id: 'forged-line' };
    const svc = { from: table => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
        data: table === 'registrations' ? row : table === 'clinic_settings'
          ? { line_channel_enabled: true, email_enabled: false } : {}, error: null,
      }) };
      return query;
    } };
    const fn = await extract(`lib/${domain}-notifications.ts`, domain === 'appointment' ? 'notifyAppointmentStatus' : 'notifyRegistrationStatus', {
      loadAppointment: async () => row, buildMessage: () => ({ subject: 'test', html: 'test' }),
      claimNotification: async () => domain === 'appointment' ? { id: 'claim', attemptCount: 1 } : 'claim',
      finishNotification: async (_svc, _id, status) => { writes.push(status); },
      isVerifiedLineRecipient: async () => false,
      getClinicLineChannelContext: async () => { throw Error('must not read LINE context'); },
      pushMessages: async () => { sends.push('line'); },
      emailConfigForClinic: async () => null,
      recordSkippedNotification: async () => {},
      publicRegistrationPaymentUrl: () => '/', decryptRegistrationToken: () => null,
      deliveryError: () => 'delivery_error:internal', console: { error: () => {} },
    });
    const result = await fn(svc, 'item', 'confirmed');
    assert.equal(result.failed, 1);
    assert.deepEqual(writes, ['failed']);
    assert.deepEqual(sends, []);
  });

  test(`${domain}: disabled LINE skips delivery while Email still sends`, async () => {
    const effects = [];
    const row = { id: 'item', clinic_id: 'brand', status: 'confirmed', name: 'Synthetic', clinic_name: 'Synthetic',
      line_user_id: 'synthetic-line', patient_line_user_id: 'synthetic-line', line_channel_enabled: false,
      email: 'synthetic@example.invalid', patient_email: 'synthetic@example.invalid', email_enabled: true };
    const svc = { from: table => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
        data: table === 'registrations' ? row : table === 'clinic_settings' ? { line_channel_enabled: false, email_enabled: true } : {}, error: null,
      }) };
      return query;
    } };
    const fn = await extract(`lib/${domain}-notifications.ts`, domain === 'appointment' ? 'notifyAppointmentStatus' : 'notifyRegistrationStatus', {
      loadAppointment: async () => row, buildMessage: () => ({ subject: 'test', html: 'test' }),
      claimNotification: async (...args) => { effects.push(`claim:${args.at(-1)}`); return domain === 'appointment' ? { id: 'claim', attemptCount: 1 } : 'claim'; },
      finishNotification: async (_svc, _id, status) => effects.push(`finish:${status}`),
      recordSkippedNotification: async (...args) => effects.push(`skip:${args.at(-2)}`),
      emailConfigForClinic: async () => ({}), sendEmail: async () => { effects.push('email'); return 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'; },
      getClinicLineChannelContext: async () => { throw Error('disabled LINE context must not be read'); },
      lineAccessTokenForDestination: async () => { throw Error('disabled LINE token must not be read'); },
      pushMessages: async () => { throw Error('disabled LINE must not send'); },
      publicRegistrationPaymentUrl: () => '/', decryptRegistrationToken: () => null,
    });
    const result = await fn(svc, 'item', 'confirmed');
    assert.deepEqual(result, { sent: 1, failed: 0, skipped: 1 });
    assert.deepEqual(effects, ['skip:line', 'claim:email', 'email', 'finish:sent']);
  });
}
