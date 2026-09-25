import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const expectedHost = 'ongjsegewpnbkqugrpom.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Staging service-record browser audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `qa-service-g30324-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
const session = `g303service${randomBytes(3).toString('hex')}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const created = {};
const result = {};
const start = new Date(Date.now() + 4 * 86400000);

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
  if (errors.length) throw new Error(`Service-record fixture cleanup failed: ${errors.join(',')}`);
  if (created.clinic) {
    const { count, error } = await db.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinic);
    if (error || count !== 0) throw new Error('Service-record clinic residual remains');
  }
  if (created.user) {
    const { data, error } = await db.auth.admin.getUserById(created.user);
    if (!error || data?.user) throw new Error('Service-record Auth residual remains');
  }
}

let workError;
try {
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error('Create isolated Auth user failed');
  created.user = user.data.user.id;
  const clinic = await must('clinic', db.from('clinics').insert({
    name: `QA Service G30324 ${suffix}`, slug: `qa-service-g30324-${suffix}`, active: true,
  }).select('id').single());
  created.clinic = clinic.id;
  await must('settings', db.from('clinic_settings').update({
    line_channel_enabled: false, email_enabled: false, crm_automation_enabled: false,
  }).eq('clinic_id', clinic.id));
  await must('brand role', db.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: created.user, role: 'admin', access_type: 'brand_admin',
    permissions: ['brand.manage', 'operations.manage'],
  }));
  const doctor = await must('doctor', db.from('doctors').insert({ clinic_id: clinic.id, name: 'QA Service Provider', active: true }).select('id').single());
  const recentPatient = await must('recent patient', db.from('patients').insert({ clinic_id: clinic.id, name: '近期顧客', phone: '0900000924' }).select('id').single());
  const oldPatient = await must('old patient', db.from('patients').insert({ clinic_id: clinic.id, name: '歷史顧客測試', phone: '0900000925' }).select('id').single());
  const appointments = Array.from({ length: 151 }, (_, index) => {
    const at = new Date(start.getTime() + index * 3600000);
    return {
      clinic_id: clinic.id, patient_id: index === 0 ? oldPatient.id : recentPatient.id, doctor_id: doctor.id,
      start_at: at.toISOString(), end_at: new Date(at.getTime() + 1800000).toISOString(), status: 'booked',
    };
  });
  const inserted = await must('151 appointments', db.from('appointments').insert(appointments).select('id,patient_id,start_at'));
  if (inserted.length !== 151) throw new Error('Appointment fixture count mismatch');
  created.oldAppointment = inserted.find(row => row.patient_id === oldPatient.id)?.id;
  if (!created.oldAppointment) throw new Error('Older appointment missing');

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

  cli('goto', `${base}/admin/operations/service-records`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('服務過程紀錄') || !snapshot.includes('搜尋預約或報名來源') || snapshot.includes('歷史顧客測試')) throw new Error('Recent source page state incorrect');
  result.recentPage = true;
  cli('fill', ref(snapshot, /(?:textbox|searchbox) "搜尋預約或報名來源" \[ref=([a-zA-Z0-9]+)\]/), '歷史顧客');
  snapshot = cli('snapshot');
  cli('click', ref(snapshot, /button "搜尋來源" \[ref=([a-zA-Z0-9]+)\]/));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    snapshot = cli('snapshot');
    if (snapshot.includes('歷史顧客測試')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!snapshot.includes('歷史顧客測試')) throw new Error('Older appointment search did not render');
  result.oldSourceSearch = true;
  cli('fill', ref(snapshot, /(?:textbox|searchbox) "搜尋預約或報名來源" \[ref=([a-zA-Z0-9]+)\]/), '不存在的隔離顧客');
  snapshot = cli('snapshot');
  cli('click', ref(snapshot, /button "搜尋來源" \[ref=([a-zA-Z0-9]+)\]/));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    snapshot = cli('snapshot');
    if (snapshot.includes('找不到符合條件的服務來源')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!snapshot.includes('找不到符合條件的服務來源') || snapshot.includes('歷史顧客測試')) throw new Error('Empty source search did not reset selection');
  result.emptySearch = true;
  cli('fill', ref(snapshot, /(?:textbox|searchbox) "搜尋預約或報名來源" \[ref=([a-zA-Z0-9]+)\]/), '0900000925');
  snapshot = cli('snapshot');
  cli('click', ref(snapshot, /button "搜尋來源" \[ref=([a-zA-Z0-9]+)\]/));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    snapshot = cli('snapshot');
    if (snapshot.includes('歷史顧客測試')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!snapshot.includes('歷史顧客測試')) throw new Error('Older appointment phone search did not render');
  result.oldSourcePhoneSearch = true;
  cli('fill', ref(snapshot, /textbox "紀錄標題" \[ref=([a-zA-Z0-9]+)\]/), '隔離歷史來源測試');
  cli('fill', ref(snapshot, /textbox "本次服務內容" \[ref=([a-zA-Z0-9]+)\]/), '已完成服務紀錄來源搜尋驗收');
  snapshot = cli('snapshot');
  cli('click', ref(snapshot, /button "儲存服務過程紀錄" \[ref=([a-zA-Z0-9]+)\]/));
  let saved = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await db.from('patient_records').select('id,appointment_id,content').eq('clinic_id', clinic.id).eq('appointment_id', created.oldAppointment);
    if (error) throw new Error(`Verify service record: ${error.code ?? 'unknown'}`);
    if (data.some(row => row.content === '已完成服務紀錄來源搜尋驗收')) { saved = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!saved) throw new Error('Older appointment record was not saved');
  result.oldSourceSaved = true;
} catch (error) {
  workError = error;
} finally {
  try { cli('close'); } catch { /* fixture cleanup is independent */ }
  try { await cleanup(); result.fixtureResidual = 0; } catch (error) {
    workError = workError ? new AggregateError([workError, error], 'Browser audit and cleanup failed') : error;
  }
}

if (workError) throw workError;
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), deployment: '63ba0b23-be36-4a3a-8dec-b5ffc6828890', ...result }));
