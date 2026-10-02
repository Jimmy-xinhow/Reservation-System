// Staging-only HTTP audit. The chosen tenant does not exist, so no business row can be selected.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const projectRef = 'ongjsegewpnbkqugrpom';
const appUrl = 'https://reservation-system-staging-staging.up.railway.app';
const dbUrl = `https://${projectRef}.supabase.co`;
const { CRON_SECRET: cronSecret, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging'
  || process.env.NEXT_PUBLIC_SUPABASE_URL !== dbUrl
  || !cronSecret || !serviceKey) {
  throw new Error('Staging scoped Cron audit guard failed');
}

const service = createClient(dbUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const clinicId = randomUUID();
const recordId = randomUUID();
const jobs = [
  'reminders', 'marketing', 'membership', 'followups',
  'registration', 'richmenu', 'subscription-freezes',
];
const scopes = {
  reminders: { clinic_id: clinicId, appointment_ids: [recordId] },
  marketing: { clinic_id: clinicId, automation_ids: [recordId], patient_ids: [recordId] },
  membership: { clinic_id: clinicId, membership_ids: [recordId] },
  followups: { clinic_id: clinicId, followup_ids: [recordId] },
  registration: {
    clinic_id: clinicId, registration_ids: [recordId], appointment_ids: [],
    membership_payment_ids: [], waitlist_ids: [],
  },
  richmenu: { clinic_id: clinicId, schedule_ids: [recordId] },
  'subscription-freezes': { clinic_id: clinicId, subscription_ids: [recordId] },
};

async function confirmNoClinic() {
  const { count, error } = await service.from('clinics').select('*', { count: 'exact', head: true })
    .eq('id', clinicId);
  if (error || count !== 0) throw new Error('Synthetic Cron tenant is not proven absent');
}

function runWorker(secret, selectedJobs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'scripts/trigger-reminders.mjs', '--scoped', `--jobs=${selectedJobs.join(',')}`,
    ], {
      cwd: process.cwd(), windowsHide: true,
      env: {
        CRON_SECRET: secret,
        CRON_HEALTH_ENABLED: '1',
        APP_URL: appUrl,
        CRON_SCOPES_JSON: JSON.stringify(Object.fromEntries(
          selectedJobs.map(job => [job, scopes[job]]),
        )),
        CRON_SCOPE_EXPIRES_AT: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => child.kill(), 180_000);
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      try {
        const records = output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        resolve({ code, records });
      } catch {
        reject(new Error('Worker did not produce safe structured records'));
      }
    });
  });
}

await confirmNoClinic();
const { count: globalBefore, error: globalBeforeError } = await service.from('cron_job_runs')
  .select('run_id', { count: 'exact', head: true }).eq('mode', 'global');
if (globalBeforeError || globalBefore === null) throw new Error('Read global Cron baseline failed');
const denied = await runWorker(`wrong-${randomUUID()}`, ['reminders']);
const deniedJob = denied.records.find(record => record.event === 'cron_job');
if (denied.code !== 1 || deniedJob?.http_status !== 401 || deniedJob.status !== 'http_failed') {
  throw new Error('Scoped Cron POST did not reject an invalid secret');
}
const accepted = await runWorker(cronSecret, jobs);
const work = accepted.records.filter(record => record.event === 'cron_job');
const run = accepted.records.find(record => record.event === 'cron_run');
if (accepted.code !== 0 || work.length !== jobs.length || run?.status !== 'success'
  || run.jobs !== jobs.length || new Set(work.map(record => record.job)).size !== jobs.length
  || work.some(record => record.status !== 'success' || record.http_status !== 200
    || record.mode !== 'scoped'
    || Object.values(record.counts ?? {}).some(value => value !== 0))) {
  throw new Error('Scoped Cron audit failed or touched unexpected records');
}
await confirmNoClinic();
const { data: heartbeats, error: heartbeatError } = await service.from('cron_job_runs')
  .select('job,mode,status,result_code,http_status')
  .eq('run_id', run.run_id);
if (heartbeatError || heartbeats?.length !== jobs.length ||
  heartbeats.some(row => row.mode !== 'scoped' || row.status !== 'success' ||
    row.result_code !== 'success' || row.http_status !== 200) ||
  new Set(heartbeats.map(row => row.job)).size !== jobs.length) {
  throw new Error('Scoped Cron heartbeat persistence failed');
}
const { count: globalAfter, error: globalAfterError } = await service.from('cron_job_runs')
  .select('run_id', { count: 'exact', head: true }).eq('mode', 'global');
if (globalAfterError || globalAfter !== globalBefore) throw new Error('Scoped Cron changed global health rows');
console.log(JSON.stringify({
  auditedAt: new Date().toISOString(), projectRef, appUrl,
  runId: run.run_id, persistedScopedHeartbeats: heartbeats.length, globalHealthRowsUnaffected: true,
  invalidSecretStatus: deniedJob.http_status,
  jobs: work.map(record => ({ job: record.job, status: record.status, httpStatus: record.http_status })),
  runStatus: run.status, noBusinessRowsSelected: true, syntheticTenantStillAbsent: true,
}));
