import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const expectedHost = 'ongjsegewpnbkqugrpom.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Staging role-browser audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `qa-g30324-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
const session = 'g30324';
const created = {};
const results = {};

async function must(label, operation) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.code ?? 'unknown_error'}`);
  return data;
}

function cli(command, ...args) {
  const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const result = spawnSync(process.execPath, [npxCli, '--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${session}`, command, ...args], {
    encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const safeOutput = ['open', 'goto', 'snapshot', 'close'].includes(command) ? (result.stdout ?? '').slice(0, 240) : '';
    throw new Error(`Browser ${command} failed: ${result.error?.code ?? result.status}; ${(result.stderr ?? '').slice(0, 240)} ${safeOutput}`);
  }
  return result.stdout;
}

function ref(snapshot, pattern) {
  const match = snapshot.match(pattern);
  if (!match) throw new Error(`Expected browser control was not in fresh snapshot: ${snapshot.slice(0, 900)}`);
  return match[1];
}

async function cleanup() {
  const errors = [];
  async function remove(table, id) {
    if (!id) return;
    const { error } = await db.from(table).delete().eq('id', id);
    if (error) errors.push(`${table}:${error.code ?? 'error'}`);
  }
  await remove('crm_delivery_logs', created.delivery);
  await remove('crm_automations', created.automation);
  await remove('crm_segments', created.segment);
  await remove('handoff_tasks', created.task);
  await remove('patients', created.patient);
  if (created.clinic && created.user) {
    const { error } = await db.from('clinic_members').delete().eq('clinic_id', created.clinic).eq('user_id', created.user);
    if (error) errors.push(`clinic_members:${error.code ?? 'error'}`);
  }
  if (created.clinic) {
    const { error: activationError } = await db.from('clinic_activation_metrics').delete().eq('clinic_id', created.clinic);
    if (activationError) errors.push(`clinic_activation_metrics:${activationError.code ?? 'error'}`);
    const { error: attendanceError } = await db.from('attendance_settings').delete().eq('clinic_id', created.clinic);
    if (attendanceError) errors.push(`attendance_settings:${attendanceError.code ?? 'error'}`);
    const { error: entitlementsError } = await db.from('brand_entitlements').delete().eq('clinic_id', created.clinic);
    if (entitlementsError) errors.push(`brand_entitlements:${entitlementsError.code ?? 'error'}`);
    const { error: settingsError } = await db.from('clinic_settings').delete().eq('clinic_id', created.clinic);
    if (settingsError) errors.push(`clinic_settings:${settingsError.code ?? 'error'}`);
    await remove('clinics', created.clinic);
  }
  if (created.user) {
    const { error } = await db.auth.admin.deleteUser(created.user);
    if (error) errors.push(`auth:${error.status ?? 'error'}`);
  }
  if (errors.length) throw new Error(`Fixture cleanup failed: ${errors.join(', ')}`);
  for (const [table, id] of [
    ['crm_delivery_logs', created.delivery], ['crm_automations', created.automation],
    ['crm_segments', created.segment], ['handoff_tasks', created.task],
    ['patients', created.patient], ['clinics', created.clinic],
  ]) {
    if (!id) continue;
    const { count, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq('id', id);
    if (error || count !== 0) throw new Error(`Fixture residual check failed: ${table}`);
  }
  if (created.user) {
    const { data, error } = await db.auth.admin.getUserById(created.user);
    if (!error || data?.user) throw new Error('Fixture Auth user remains');
  }
}

let workError;
try {
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error('Create isolated Auth user failed');
  created.user = user.data.user.id;
  const clinic = await must('clinic', db.from('clinics').insert({
    name: 'QA G3-03 Role Brand', slug: `qa-g30324-${suffix}`, active: true,
  }).select('id').single());
  created.clinic = clinic.id;
  await must('settings', db.from('clinic_settings').upsert({
    clinic_id: clinic.id, crm_automation_enabled: true, line_channel_enabled: true,
  }, { onConflict: 'clinic_id' }));
  await must('member', db.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: created.user, role: 'admin', access_type: 'brand_admin',
    permissions: ['brand.manage', 'operations.manage'],
  }));
  const patient = await must('patient', db.from('patients').insert({
    clinic_id: clinic.id, name: `QA G30324 Customer ${suffix}`,
    phone: `09${String(Date.now()).slice(-8)}`,
  }).select('id').single());
  created.patient = patient.id;
  const task = await must('handoff', db.from('handoff_tasks').insert({
    clinic_id: clinic.id, title: `QA G30324 Handoff ${suffix}`, assigned_to: created.user,
    category: 'customer', priority: 'high',
  }).select('id').single());
  created.task = task.id;
  const segment = await must('segment', db.from('crm_segments').insert({
    clinic_id: clinic.id, name: `QA G30324 Segment ${suffix}`,
    rule_type: 'tag_contains', rule_value: 'qa', active: false,
  }).select('id').single());
  created.segment = segment.id;
  const automation = await must('automation', db.from('crm_automations').insert({
    clinic_id: clinic.id, name: `QA G30324 Automation ${suffix}`,
    trigger_type: 'inactive', channel: 'email', body: 'QA only', active: false,
  }).select('id').single());
  created.automation = automation.id;
  const delivery = await must('delivery', db.from('crm_delivery_logs').insert({
    clinic_id: clinic.id, automation_id: automation.id, patient_id: patient.id,
    trigger_key: `qa-g30324-${suffix}`, channel: 'email', status: 'skipped',
  }).select('id').single());
  created.delivery = delivery.id;

  cli('open', `${base}/admin/login`);
  const login = cli('snapshot');
  cli('fill', ref(login, /textbox "Email" \[ref=([a-zA-Z0-9]+)\]/), email);
  cli('fill', ref(login, /textbox "密碼" \[ref=([a-zA-Z0-9]+)\]/), password);
  cli('click', ref(login, /button "(?:進入品牌營運|登入品牌營運後台)" \[ref=([a-zA-Z0-9]+)\]/));
  let afterLogin = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    afterLogin = cli('snapshot');
    if (afterLogin.includes('/admin/dashboard')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!afterLogin.includes('/admin/dashboard')) throw new Error(`Brand admin did not reach dashboard: ${afterLogin.replaceAll(password, '[redacted]').slice(-900)}`);
  results.login = true;

  for (const [name, path, expected] of [
    ['handoff', '/admin/handoff', `QA G30324 Handoff ${suffix}`],
    ['crm', '/admin/crm', `QA G30324 Segment ${suffix}`],
    ['crmDeliveries', '/admin/crm/deliveries', `QA G30324 Automation ${suffix}`],
    ['line', '/admin/line', 'heading "LINE 互動中心"'],
    ['patientDetail', `/admin/patients/${patient.id}`, `QA G30324 Customer ${suffix}`],
  ]) {
    cli('goto', `${base}${path}`);
    const snapshot = cli('snapshot');
    if (!snapshot.includes(`Page URL: ${base}${path}`) || !snapshot.includes(expected)) {
      throw new Error(`Live ${name} page did not show scoped fixture`);
    }
    results[name] = true;
  }
} catch (error) {
  workError = error;
} finally {
  try { cli('close'); } catch { /* browser cleanup is secondary to data cleanup */ }
  try { await cleanup(); results.fixtureResidual = 0; } catch (error) { workError = workError ? new AggregateError([workError, error], 'Browser audit and fixture cleanup failed') : error; }
}

if (workError) throw workError;
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), deployment: '80c837d9-d3f9-4274-9a3d-d05ec5a9afbb', ...results }));
