import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Railway cron: discover current work on each invocation; never call global GET jobs.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rawIds = process.env.CRON_ALLOWED_CLINIC_IDS?.split(',').map(id => id.trim().toLowerCase()) ?? [];
const clinicIds = [...new Set(rawIds)];
const baseUrl = process.env.APP_URL?.replace(/\/$/, '');
const secret = process.env.CRON_SECRET;
const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!rawIds.length || rawIds.length !== clinicIds.length || clinicIds.some(id => !uuid.test(id)) ||
    !baseUrl || !/^https:\/\//.test(baseUrl) || !secret || !dbUrl || !dbKey) {
  console.error(JSON.stringify({ event: 'cron_config', status: 'invalid_allowlisted_worker_config',
    reasons: { missing_ids: !rawIds.length, duplicate_ids: rawIds.length !== clinicIds.length,
      invalid_ids: clinicIds.some(id => !uuid.test(id)), invalid_url: !baseUrl || !/^https:\/\//.test(baseUrl),
      missing_secret: !secret, missing_db_url: !dbUrl, missing_db_key: !dbKey } }));
  process.exit(1);
}

const argv = process.argv.slice(2);
const planOnly = argv.includes('--plan-only');
const jobArgs = argv.filter(arg => arg.startsWith('--jobs='));
const selected = jobArgs.length === 1 ? jobArgs[0].slice(7).split(',') : null;
const jobs = ['reminders', 'marketing', 'membership', 'followups', 'registration', 'richmenu', 'subscription-freezes'];
if (argv.length !== Number(planOnly) + Number(selected !== null) || argv.filter(arg => arg === '--plan-only').length > 1 ||
  (selected &&
  (new Set(selected).size !== selected.length || selected.some(job => !jobs.includes(job))))) {
  console.error(JSON.stringify({ event: 'cron_config', status: 'invalid_jobs' }));
  process.exit(1);
}
const service = createClient(dbUrl, dbKey, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = randomUUID();
const now = new Date().toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const counters = new Set(['scanned','candidates','claimed','sent','failed','line','email','lineFailed','emailFailed','skipped','duplicate','processed','changed','expired','expired_appointments','expired_membership_payments','expired_waitlist_offers','released_benefits','unconfirmed','crm_failed','status_write_failed']);

async function ids(table, clinicId, configure = query => query, column = 'id') {
  const query = configure(service.from(table).select(column).eq('clinic_id', clinicId).limit(101));
  const { data, error } = await query;
  if (error) throw new Error(`query_${table}`);
  if ((data?.length ?? 0) > 100) throw new Error(`scope_too_large_${table}`);
  return (data ?? []).map(row => row[column]);
}
function unique(values) {
  const result = [...new Set(values.filter(Boolean))];
  if (result.length > 100) throw new Error('scope_too_large_combined');
  return result;
}
async function plan(job, clinicId) {
  if (job === 'reminders') {
    const appointment_ids = await ids('appointments', clinicId, q => q.in('status', ['booked','confirmed']).gte('start_at', now));
    return appointment_ids.length ? { clinic_id: clinicId, appointment_ids } : null;
  }
  if (job === 'marketing') {
    const [automation_ids, patient_ids] = await Promise.all([
      ids('crm_automations', clinicId, q => q.eq('active', true).is('archived_at', null)),
      ids('patients', clinicId, q => q.eq('active', true).eq('marketing_opt_in', true)),
    ]);
    return automation_ids.length && patient_ids.length ? { clinic_id: clinicId, automation_ids, patient_ids } : null;
  }
  if (job === 'membership') {
    const membership_ids = await ids('patient_memberships', clinicId, q => q.eq('status', 'active'));
    return membership_ids.length ? { clinic_id: clinicId, membership_ids } : null;
  }
  if (job === 'followups') {
    const followup_ids = await ids('scheduled_followups', clinicId,
      q => q.eq('status', 'pending').in('channel', ['line','email']).lte('scheduled_for', now));
    return followup_ids.length ? { clinic_id: clinicId, followup_ids } : null;
  }
  if (job === 'richmenu') {
    const schedule_ids = await ids('line_richmenu_schedules', clinicId,
      q => q.in('status', ['scheduled','active','activating','expiring']));
    return schedule_ids.length ? { clinic_id: clinicId, schedule_ids } : null;
  }
  if (job === 'subscription-freezes') {
    const subscription_ids = unique(await ids('subscription_freezes', clinicId,
      q => q.in('status', ['scheduled','active']).lte('starts_on', today), 'subscription_id'));
    return subscription_ids.length ? { clinic_id: clinicId, subscription_ids } : null;
  }
  const [expiringRegistrations, benefitRegistrations, registrationEvents, waitingRegistrationIds,
    expiringAppointments, appointmentEvents, membershipPayments,
    expiringWaitlists, waitlistNotifications] = await Promise.all([
    ids('registrations', clinicId, q => q.eq('status', 'pending').eq('payment_status', 'pending').lte('expires_at', now)),
    ids('registrations', clinicId, q => q.eq('status', 'cancelled').in('payment_status', ['failed','expired'])),
    ids('registration_status_events', clinicId, q => q.is('notification_processed_at', null), 'registration_id'),
    ids('waitlist_entries', clinicId, q => q.eq('status', 'waiting'), 'registration_id'),
    ids('appointments', clinicId, q => q.in('status', ['booked','confirmed']).eq('deposit_status', 'pending').lte('deposit_expires_at', now)),
    ids('appointment_status_events', clinicId, q => q.is('notification_processed_at', null), 'appointment_id'),
    ids('payment_orders', clinicId, q => q.eq('status', 'pending').not('membership_plan_id', 'is', null).lte('expires_at', now)),
    ids('appointment_waitlist_entries', clinicId, q => q.in('status', ['waiting','offered'])),
    ids('appointment_waitlist_notification_logs', clinicId, q => q.in('status', ['pending','failed']), 'waitlist_id'),
  ]);
  const registration_ids = unique([...expiringRegistrations, ...benefitRegistrations, ...registrationEvents, ...waitingRegistrationIds]);
  const appointment_ids = unique([...expiringAppointments, ...appointmentEvents]);
  const membership_payment_ids = unique(membershipPayments);
  const waitlist_ids = unique([...expiringWaitlists, ...waitlistNotifications]);
  return registration_ids.length + appointment_ids.length + membership_payment_ids.length + waitlist_ids.length
    ? { clinic_id: clinicId, registration_ids, appointment_ids, membership_payment_ids, waitlist_ids } : null;
}

async function post(url, body, timeoutMs = 60_000) {
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed?.ok !== true) throw new Error(`http_${response.status}`);
  return parsed;
}

let failures = 0;
for (const job of jobs.filter(job => !selected || selected.includes(job))) {
  const started = Date.now();
  let status = 'success', httpStatus = 200, selectedClinics = 0, counts = {};
  try {
    for (const clinicId of clinicIds) {
      const { data: clinic, error } = await service.from('clinics').select('id').eq('id', clinicId).eq('active', true).maybeSingle();
      if (error) throw new Error('clinic_lookup_failed');
      if (!clinic) throw new Error('allowlisted_clinic_inactive');
      const scope = await plan(job, clinicId);
      if (!scope) continue;
      selectedClinics += 1;
      if (planOnly) {
        for (const [key, value] of Object.entries(scope)) {
          if (Array.isArray(value)) counts[key] = (counts[key] ?? 0) + value.length;
        }
        continue;
      }
      const result = await post(`${baseUrl}/api/cron/${job}`, scope);
      for (const [key, value] of Object.entries(result)) {
        if (counters.has(key) && typeof value === 'number' && Number.isFinite(value)) counts[key] = (counts[key] ?? 0) + value;
      }
    }
  } catch (error) {
    status = 'failed'; httpStatus = null; failures += 1;
    console.error(JSON.stringify({ event: 'cron_job_error', run_id: runId, job,
      code: error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64) : 'unknown' }));
  }
  console.log(JSON.stringify({ event: planOnly ? 'cron_plan' : 'cron_job', run_id: runId, mode: 'scoped', job, status,
    selected_clinics: selectedClinics, duration_ms: Date.now() - started, counts }));
  if (!planOnly && process.env.CRON_HEALTH_ENABLED === '1') {
    try {
      await post(`${baseUrl}/api/cron/health`, { run_id: runId, mode: 'scoped', job, status,
        result_code: status === 'success' ? 'success' : 'request_failed', http_status: httpStatus }, 10_000);
    } catch {
      failures += 1;
      console.error(JSON.stringify({ event: 'cron_health_write', run_id: runId, job, status: 'failed' }));
    }
  }
}
console.log(JSON.stringify({ event: planOnly ? 'cron_plan_complete' : 'cron_run', run_id: runId, mode: 'scoped',
  status: failures ? 'failed' : 'success', jobs: selected?.length ?? jobs.length }));
process.exit(failures ? 1 : 0);
