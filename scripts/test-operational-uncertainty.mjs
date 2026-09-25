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
    for (const failure of ['none', 'provider', 'write', 'lost_ack']) {
      test(`${job}/${channel}/${failure}: uncertain outcomes never become retryable`, async () => {
        const writes = [], logs = []; let sent = 0, state = job === 'reminders' ? 'sending' : job === 'marketing' ? 'pending' : 'claimed';
        const patient = { clinic_id: 'brand', name: 'synthetic', active: true, marketing_opt_in: true, line_user_id: channel === 'line' ? 'synthetic' : null, email: channel === 'email' ? 'synthetic@example.invalid' : null };
        const row = { id: 'item', log_id: 'claim', clinic_id: 'brand', patient_id: 'patient', patients: patient, credits_remaining: 1, expires_at: null, kind: 'joined', channel, ...patient, email_enabled: true };
        const svc = { from: table => { const q = { select: () => q, eq: () => q, in: () => q, gt: () => q, lte: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: {}, error: null }), then: (resolve, reject) => Promise.resolve({ data: [row], error: null }).then(resolve, reject) }; return q; }, rpc: async () => ({ data: [row], error: null }) };
        const send = async () => { sent++; if (failure === 'provider') throw Error('secret provider'); };
        const finish = async (_svc, _id, status) => {
          if (status === 'skipped') return;
          writes.push(status); if (failure === 'write') throw Error('secret DB'); state = status;
          if (failure === 'lost_ack') throw Error('secret ack');
        };
        const deps = { getClinicSettings: async () => ({ booking_mode: 'time', email_enabled: true }),
          lineAccessTokenForDestination: async () => 'synthetic', emailConfigForClinic: async () => ({}),
          getClinicLineChannelContext: async () => ({ enabled: true }), customerEntryUrl: () => '/',
          pushMessages: send, sendEmail: send, claimReminder: async () => 'claim', finishReminder: finish,
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
        if (job === 'marketing') { result = { sent: 0, failed: 0, skipped: 0, duplicate: 0 }; await fn(svc, { channel, trigger_type: 'birthday' }, { email_enabled: true }, 'brand', result, 'brand', 'token', null); }
        else result = await fn(svc, job === 'membership' ? { id: 'brand' } : job === 'waitlist' ? 50 : 'brand');
        assert.equal(sent, 1);
        assert(!writes.includes('failed'));
        assert.equal(state, failure === 'none' || failure === 'lost_ack' ? 'sent' : job === 'reminders' ? 'sending' : job === 'marketing' ? 'pending' : 'claimed');
        const failures = result.failed ?? (result.lineFailed + result.emailFailed);
        assert.equal(failures, failure === 'none' ? 0 : 1);
        assert(!JSON.stringify(logs).includes('secret'));
      });
    }
  }
}
