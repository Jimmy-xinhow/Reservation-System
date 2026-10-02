import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const expectedHost = 'ongjsegewpnbkqugrpom.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Staging Rich Menu browser audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `qa-richmenu-g30324-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
const session = `g303menu${randomBytes(3).toString('hex')}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const created = {};
const result = { pageFailures: {} };

function cli(command, ...args) {
  const output = spawnSync(process.execPath, [npxCli, '--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${session}`, command, ...args], {
    encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  if (output.error || output.status !== 0) throw new Error(`Browser ${command} failed: ${output.error?.code ?? output.status}`);
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
      'line_richmenu_schedules', 'line_richmenu_aliases', 'line_richmenu_publication_events',
      'line_richmenu', 'line_richmenu_versions', 'line_auto_replies', 'line_messages', 'funnel_events',
      'patient_records', 'appointment_waitlist_notification_logs', 'appointment_waitlist_events',
      'appointment_waitlist_entries', 'appointment_status_events', 'appointment_notification_logs',
      'reminder_logs', 'crm_interactions', 'appointments', 'doctors', 'patients', 'clinic_members',
      'attendance_settings', 'clinic_line_channels', 'brand_entitlements', 'clinic_activation_metrics',
      'clinic_settings', 'clinics',
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
  if (errors.length) throw new Error(`Rich Menu fixture cleanup failed: ${errors.join(',')}`);
  if (created.clinic) {
    const { count, error } = await db.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinic);
    if (error || count !== 0) throw new Error('Rich Menu clinic residual remains');
  }
  if (created.user) {
    const { data, error } = await db.auth.admin.getUserById(created.user);
    if (!error || data?.user) throw new Error('Rich Menu Auth residual remains');
  }
}

let workError;
try {
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error('Create isolated Auth user failed');
  created.user = user.data.user.id;
  const clinic = await must('clinic', db.from('clinics').insert({
    name: `QA Rich Menu G30324 ${suffix}`, slug: `qa-richmenu-g30324-${suffix}`, active: true,
  }).select('id').single());
  created.clinic = clinic.id;
  await must('settings', db.from('clinic_settings').update({
    line_channel_enabled: true, legacy_progress_enabled: true,
    events_enabled: true, public_registration_enabled: true,
    email_enabled: false, crm_automation_enabled: false,
  }).eq('clinic_id', clinic.id));
  await must('brand role', db.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: created.user, role: 'admin', access_type: 'brand_admin',
    permissions: ['brand.manage', 'operations.manage'],
  }));
  const version = await must('archived version', db.from('line_richmenu_versions').insert({
    clinic_id: clinic.id, version_no: 999, name: 'QA Archived Menu', template_key: 'mixed',
    layout: 'full-3', slots: [], status: 'archived',
  }).select('id').single());
  result.versionId = version.id;
  const doctor = await must('doctor', db.from('doctors').insert({
    clinic_id: clinic.id, name: 'QA Reschedule Provider', active: true,
  }).select('id').single());
  const patient = await must('patient', db.from('patients').insert({
    clinic_id: clinic.id, name: 'QA Reschedule Customer', phone: '0900000924',
  }).select('id').single());
  const appointment = await must('appointment', db.from('appointments').insert({
    clinic_id: clinic.id, patient_id: patient.id, doctor_id: doctor.id,
    start_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    end_at: new Date(Date.now() + 7 * 86400000 + 1800000).toISOString(),
    status: 'booked',
  }).select('id').single());

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

  cli('goto', `${base}/admin/richmenu`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('LINE 圖文選單版本與發布') || !snapshot.includes('QA Archived Menu') || !snapshot.includes('發布前檢查')) {
    throw new Error('Rich Menu source data did not render');
  }
  if (!snapshot.includes('品牌訊息授權') || !snapshot.includes('未發布')) {
    throw new Error('Rich Menu channel readiness did not render');
  }
  result.richMenuVersionAndReadiness = true;

  for (const [path, heading] of [
    ['/admin/chat', '線上客服'],
    ['/admin/line-templates', 'LINE 訊息範本'],
    ['/admin/messages', '自訂訊息素材'],
    ['/admin/replies', '自動回覆設定'],
    ['/admin/queue', '現場叫號'],
  ]) {
    try {
      cli('goto', `${base}${path}`);
      snapshot = cli('snapshot');
      if (!snapshot.includes(heading) || snapshot.includes('此功能尚未開通') || snapshot.includes('登入品牌營運後台')) {
        throw new Error('Expected enabled-module projection missing');
      }
      result[path] = true;
    } catch (error) {
      result.pageFailures[path] = error.message;
    }
  }

  for (const [path, heading] of [
    ['/admin/channels', '通知與付款檢查'],
    ['/admin/course-content', '課程內容與學習驗收'],
    ['/admin/customer-value', '顧客資產與訂閱'],
    ['/admin/documents', '同意書與電子簽署'],
    ['/admin/events', '課程與活動報名'],
    ['/admin/fitness', '教室與會籍營運'],
    ['/admin/followups', '指定日期回訪'],
    ['/admin/registrations', '報名名單'],
    [`/admin/appointments/${appointment.id}/reschedule`, 'QA Reschedule Customer'],
  ]) {
    try {
      cli('goto', `${base}${path}`);
      snapshot = cli('snapshot');
      if (!snapshot.includes(heading) || snapshot.includes('此功能尚未開通') || snapshot.includes('登入品牌營運後台')) {
        throw new Error('Expected authenticated projection missing');
      }
      result[path.startsWith('/admin/appointments/') ? '/admin/appointments/[id]/reschedule' : path] = true;
    } catch (error) {
      result.pageFailures[path] = error.message;
    }
  }
} catch (error) {
  workError = error;
} finally {
  try { cli('close'); } catch { /* cleanup is independent */ }
  try { await cleanup(); result.fixtureResidual = 0; } catch (error) {
    workError = workError ? new AggregateError([workError, error], 'Browser audit and cleanup failed') : error;
  }
}

console.log(JSON.stringify({ auditedAt: new Date().toISOString(), ...result }));
if (workError) throw workError;
if (Object.keys(result.pageFailures).length) throw new Error(`${Object.keys(result.pageFailures).length} authenticated page projections failed`);
