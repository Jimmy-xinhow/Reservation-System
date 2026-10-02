import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const expectedHost = 'ongjsegewpnbkqugrpom.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Staging dashboard/reports browser audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `qa-dashreport-g30324-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
const session = `g303dash${randomBytes(3).toString('hex')}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const created = {};
const result = {};
const localDate = offset => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(Date.now() + offset * 86400000));

function cli(command, ...args) {
  const output = spawnSync(process.execPath, [npxCli, '--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${session}`, command, ...args], {
    encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  if (output.error || output.status !== 0) {
    throw new Error(`Browser ${command} failed: ${output.error?.code ?? output.status}`);
  }
  return output.stdout;
}

function ref(snapshot, pattern) {
  const match = snapshot.match(pattern);
  if (!match) throw new Error(`Expected browser control missing: ${pattern.source}`);
  return match[1];
}

async function must(label, operation) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.code ?? 'unknown'}`);
  return data;
}

async function cleanup() {
  const errors = [];
  if (created.clinic) {
    for (const table of [
      'patient_records', 'appointment_waitlist_notification_logs', 'appointment_waitlist_events', 'appointment_waitlist_entries', 'appointment_status_events',
      'appointment_notification_logs', 'reminder_logs', 'crm_interactions', 'appointments',
      'doctors', 'patients', 'clinic_members', 'attendance_settings', 'clinic_line_channels',
      'brand_entitlements', 'clinic_activation_metrics', 'clinic_settings', 'clinics',
    ]) {
      const column = table === 'clinics' ? 'id' : 'clinic_id';
      const { error } = await db.from(table).delete().eq(column, created.clinic);
      if (error) errors.push(`${table}:${error.code ?? 'unknown'}`);
    }
  }
  if (created.user) {
    const { error } = await db.auth.admin.deleteUser(created.user);
    if (error) errors.push(`auth:${error.status ?? 'unknown'}`);
  }
  if (errors.length) throw new Error(`Dashboard/reports fixture cleanup failed: ${errors.join(',')}`);
  if (created.clinic) {
    const { count, error } = await db.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinic);
    if (error || count !== 0) throw new Error('Dashboard/reports clinic residual remains');
  }
  if (created.user) {
    const { data, error } = await db.auth.admin.getUserById(created.user);
    if (!error || data?.user) throw new Error('Dashboard/reports Auth residual remains');
  }
}

let workError;
try {
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error('Create isolated Auth user failed');
  created.user = user.data.user.id;
  const clinic = await must('clinic', db.from('clinics').insert({
    name: `QA Dashboard Report G30324 ${suffix}`, slug: `qa-dashreport-g30324-${suffix}`, active: true,
  }).select('id').single());
  created.clinic = clinic.id;
  await must('settings', db.from('clinic_settings').update({
    line_channel_enabled: false, email_enabled: false, crm_automation_enabled: false,
  }).eq('clinic_id', clinic.id));
  await must('brand role', db.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: created.user, role: 'admin', access_type: 'brand_admin',
    permissions: ['brand.manage', 'operations.manage'],
  }));
  const doctor = await must('doctor', db.from('doctors').insert({ clinic_id: clinic.id, name: 'QA Report Provider', active: true }).select('id').single());
  const patient = await must('patient', db.from('patients').insert({ clinic_id: clinic.id, name: 'QA Report Customer', phone: '0900000930' }).select('id').single());
  for (const [label, date, status] of [['today', localDate(0), 'booked'], ['yesterday', localDate(-1), 'done']]) {
    const start = new Date(`${date}T10:00:00+08:00`);
    await must(`${label} appointment`, db.from('appointments').insert({
      clinic_id: clinic.id, patient_id: patient.id, doctor_id: doctor.id,
      start_at: start.toISOString(), end_at: new Date(start.getTime() + 1800000).toISOString(), status,
    }));
  }
  result.databaseAppointments = 2;

  cli('open', `${base}/admin/login`);
  let snapshot = cli('snapshot');
  cli('fill', ref(snapshot, /textbox "Email" \[ref=([a-zA-Z0-9]+)\]/), email);
  snapshot = cli('snapshot');
  cli('fill', ref(snapshot, /textbox "密碼" \[ref=([a-zA-Z0-9]+)\]/), password);
  snapshot = cli('snapshot');
  cli('click', ref(snapshot, /button "(?:進入品牌營運|登入品牌營運後台)" \[ref=([a-zA-Z0-9]+)\]/));
  let loggedIn = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    snapshot = cli('snapshot');
    if (snapshot.includes('/admin/dashboard')) { loggedIn = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!loggedIn) throw new Error('Brand manager did not reach dashboard');
  result.login = true;

  cli('goto', `${base}/admin/dashboard`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('今日工作台') || !snapshot.includes('QA Report Provider') || !snapshot.includes('今日服務預約')) throw new Error('Dashboard did not show isolated today appointment');
  result.dashboardToday = true;

  cli('goto', `${base}/admin/reports`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('QA Report Provider') || !snapshot.includes('預約明細分組')) throw new Error('Report did not show isolated appointment provider');
  result.reportProvider = true;
} catch (error) {
  workError = error;
} finally {
  try { cli('close'); } catch { /* fixture cleanup is independent */ }
  try { await cleanup(); result.fixtureResidual = 0; } catch (error) {
    workError = workError ? new AggregateError([workError, error], 'Browser audit and cleanup failed') : error;
  }
}

if (workError) throw workError;
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), base, ...result }));
