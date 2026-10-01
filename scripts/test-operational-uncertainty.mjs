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

for (const job of ['reminders', 'marketing', 'membership', 'waitlist']) {
  for (const channel of ['line', 'email']) {
    for (const failure of ['none', 'provider', 'write', 'lost_ack', ...(channel === 'email' ? ['rejected'] : [])]) {
      test(`${job}/${channel}/${failure}: uncertain outcomes never become retryable`, async () => {
        const writes = [], logs = []; let sent = 0, state = job === 'reminders' ? 'sending' : job === 'marketing' ? 'pending' : 'claimed';
        const patient = { clinic_id: 'brand', name: 'synthetic', active: true, marketing_opt_in: true, line_user_id: channel === 'line' ? 'synthetic' : null, email: channel === 'email' ? 'synthetic@example.invalid' : null };
        const row = { id: 'item', log_id: 'claim', clinic_id: 'brand', patient_id: 'patient', waitlist_id: 'waitlist', membership_plans: { clinic_id: 'brand', name: 'Synthetic' }, patients: patient, credits_remaining: 1, expires_at: null, kind: 'joined', channel, ...patient, email_enabled: true };
        const svc = { from: table => { const q = { select: () => q, eq: () => q, in: () => q, gt: () => q, lte: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: table === 'appointment_waitlist_entries' ? { patient_id: 'patient' } : {}, error: null }), then: (resolve, reject) => Promise.resolve({ data: [row], error: null }).then(resolve, reject) }; return q; }, rpc: async () => ({ data: [row], error: null }) };
        const send = async () => { sent++; if (failure === 'provider') throw Error('secret provider'); if (failure === 'rejected') throw Error('delivery_error:provider_rejected'); };
        const finish = async (_svc, _id, status) => {
          if (status === 'skipped') return;
          writes.push(status); if (failure === 'write') throw Error('secret DB'); state = status;
          if (failure === 'lost_ack') throw Error('secret ack');
        };
        const deps = { getClinicSettings: async () => ({ booking_mode: 'time', email_enabled: true, line_channel_enabled: true }),
          lineAccessTokenForDestination: async () => 'synthetic', emailConfigForClinic: async () => ({}),
          getClinicLineChannelContext: async () => ({ enabled: true }), customerEntryUrl: () => '/',
          pushMessages: send, sendEmail: send, isVerifiedLineRecipient: async () => true, isEmailProviderRejected: error => error?.message === 'delivery_error:provider_rejected', claimReminder: async () => 'claim', finishReminder: finish,
          claimNotification: async () => 'claim', finishNotification: finish, finish,
          claimDelivery: async () => 'claim', markDelivery: finish, resolveTargetIds: async () => ['patient'],
          getCandidates: async () => [{ patient }], hasRecentDelivery: async () => false,
          renderTemplate: () => 'test', recordCrmInteraction: async () => {},
          buildReminderFlex: () => ({}), buildReminderHtml: () => '', buildWaitlistStatusFlex: () => ({}),
          lineFlexDesignForDelivery: () => ({}), waitlistText: () => '', waitlistSubject: () => '', formatDateTime: () => '',
          escapeHtml: x => x, one: x => x, numberEnv: (_key, fallback) => fallback, taipeiDate: () => '2026-09-21',
          process: { env: {} }, console: { error: (...args) => logs.push(args) }, deliveryError: () => 'delivery_error:internal' };
        const path = job === 'waitlist' ? 'lib/appointment-waitlist-notifications.ts' : `app/api/cron/${job}/route.ts`;
        const fn = await extract(path, { reminders: 'runReminderClinic', marketing: 'runAutomation', membership: 'runClinic', waitlist: 'processAppointmentWaitlistNotificationQueue' }[job], deps);
        let result;
        if (job === 'marketing') { result = { sent: 0, failed: 0, skipped: 0, duplicate: 0 }; await fn(svc, { channel, trigger_type: 'birthday' }, { email_enabled: true, line_channel_enabled: true }, 'brand', result, 'brand', 'token', null); }
        else result = await fn(svc, job === 'membership' ? { id: 'brand' } : job === 'waitlist' ? 50 : 'brand');
        assert.equal(sent, 1);
        assert.equal(writes.includes('failed'), failure === 'rejected');
        assert.equal(state, failure === 'rejected' ? 'failed' : failure === 'none' || failure === 'lost_ack' ? 'sent' : job === 'reminders' ? 'sending' : job === 'marketing' ? 'pending' : 'claimed');
        const failures = result.failed ?? (result.lineFailed + result.emailFailed);
        assert.equal(failures, failure === 'none' ? 0 : 1);
        assert(!JSON.stringify(logs).includes('secret'));
      });
    }
  }
}

test('disabled LINE reminder does not claim or send LINE while Email still delivers', async () => {
  const effects = [];
  const appointment = { id: 'appointment', start_at: new Date(Date.now() + 3600000).toISOString(),
    patients: { line_user_id: 'synthetic-line', email: 'synthetic@example.invalid' } };
  const svc = { from: table => {
    const query = { select: () => query, eq: () => query, in: () => query, gt: () => query, lte: () => query,
      maybeSingle: async () => ({ data: { name: 'Synthetic' }, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: table === 'appointments' ? [appointment] : [], error: null }).then(resolve, reject) };
    return query;
  } };
  const fn = await extract('app/api/cron/reminders/route.ts', 'runReminderClinic', {
    getClinicSettings: async () => ({ booking_mode: 'time', email_enabled: true, line_channel_enabled: false }),
    lineAccessTokenForDestination: async () => { throw Error('disabled LINE token must not be read'); },
    getClinicLineChannelContext: async () => ({ clinicSlug: 'synthetic', liffId: null }), customerEntryUrl: () => '/',
    claimReminder: async (_svc, _id, channel) => { effects.push(`claim:${channel}`); return 'claim'; },
    finishReminder: async (_svc, _id, status) => effects.push(`finish:${status}`),
    pushMessages: async () => { throw Error('disabled LINE must not send'); },
    emailConfigForClinic: async () => ({}), sendEmail: async () => effects.push('email'),
    buildReminderHtml: () => 'test', buildReminderFlex: () => ({}), process: { env: {} },
  });
  const result = await fn(svc, 'brand');
  assert.deepEqual(result, { line: 0, lineFailed: 0, email: 1, emailFailed: 0, scanned: 1 });
  assert.deepEqual(effects, ['claim:email', 'email', 'finish:sent']);
});

test('disabled LINE membership notification is skipped while Email still delivers', async () => {
  const effects = [];
  const membership = { id: 'membership', clinic_id: 'brand', credits_remaining: 1, expires_at: null,
    patients: { clinic_id: 'brand', line_user_id: 'synthetic-line', email: 'synthetic@example.invalid' }, membership_plans: { clinic_id: 'brand', name: 'Synthetic' } };
  const svc = { from: () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
      then: (resolve, reject) => Promise.resolve({ data: [membership], error: null }).then(resolve, reject) };
    return query;
  } };
  const fn = await extract('app/api/cron/membership/route.ts', 'runClinic', {
    getClinicSettings: async () => ({ email_enabled: true, line_channel_enabled: false }),
    one: value => value, numberEnv: (_name, fallback) => fallback, taipeiDate: () => '2026-09-29', escapeHtml: value => value,
    lineAccessTokenForDestination: async () => { throw Error('disabled LINE token must not be read'); },
    claimNotification: async (_svc, _row, _kind, channel) => channel,
    finishNotification: async (_svc, channel, status) => effects.push(`${channel}:${status}`),
    pushMessages: async () => { throw Error('disabled LINE must not send'); },
    emailConfigForClinic: async () => ({}), sendEmail: async () => effects.push('email'),
  });
  const result = await fn(svc, { id: 'brand', name: 'Synthetic', line_destination: null });
  assert.equal(result.sent, 1); assert.equal(result.skipped, 1); assert.equal(result.failed, 0);
  assert.deepEqual(effects, ['line:skipped', 'email', 'email:sent']);
});

test('disabled LINE marketing marks delivery skipped without a provider call', async () => {
  const effects = [];
  const fn = await extract('app/api/cron/marketing/route.ts', 'runAutomation', {
    resolveTargetIds: async () => ['patient'], getCandidates: async () => [{ patient: { id: 'patient', marketing_opt_in: true,
      blocked_until: null, line_user_id: 'synthetic-line' } }],
    claimDelivery: async () => 'claim', markDelivery: async (_svc, _claim, status) => effects.push(status),
    emailConfigForClinic: async () => { throw Error('disabled LINE must not check Email'); },
    pushMessages: async () => { throw Error('disabled LINE must not send'); },
  });
  const summary = { sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  const result = await fn({}, { channel: 'line', trigger_type: 'birthday' },
    { email_enabled: false, line_channel_enabled: false }, 'Synthetic', summary, 'brand', 'token', null);
  assert.deepEqual(result, { scanned: 1 });
  assert.deepEqual(summary, { sent: 0, failed: 0, skipped: 1, duplicate: 0 });
  assert.deepEqual(effects, ['skipped']);
});
