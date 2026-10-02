import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const expectedHost = 'ongjsegewpnbkqugrpom.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Staging import audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `qa-import-g30324-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
const browserSession = `g303import${randomBytes(3).toString('hex')}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const created = {};
const result = {};

function cli(command, ...args) {
  const output = spawnSync(process.execPath, [npxCli, '--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${browserSession}`, command, ...args], {
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
    for (const table of ['data_import_jobs', 'clinic_members', 'attendance_settings', 'clinic_line_channels',
      'brand_entitlements', 'clinic_activation_metrics', 'clinic_settings', 'clinics']) {
      const { error } = await db.from(table).delete().eq(table === 'clinics' ? 'id' : 'clinic_id', created.clinic);
      if (error) errors.push(`${table}:${error.code ?? 'unknown'}`);
    }
  }
  if (created.user) {
    const { error } = await db.auth.admin.deleteUser(created.user);
    if (error) errors.push(`auth:${error.status ?? 'unknown'}`);
  }
  if (errors.length) throw new Error(`Import fixture cleanup failed: ${errors.join(',')}`);
  if (created.clinic) {
    const { count, error } = await db.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinic);
    if (error || count !== 0) throw new Error('Import clinic residual remains');
  }
  if (created.user) {
    const { data, error } = await db.auth.admin.getUserById(created.user);
    if (!error || data?.user) throw new Error('Import Auth residual remains');
  }
}

let workError;
try {
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error('Create isolated Auth user failed');
  created.user = user.data.user.id;
  const clinic = await must('clinic', db.from('clinics').insert({
    name: `QA Import G30324 ${suffix}`, slug: `qa-import-g30324-${suffix}`, active: true,
  }).select('id').single());
  created.clinic = clinic.id;
  await must('settings', db.from('clinic_settings').update({
    line_channel_enabled: false, email_enabled: false, crm_automation_enabled: false,
  }).eq('clinic_id', clinic.id));
  await must('brand role', db.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: created.user, role: 'admin', access_type: 'brand_admin',
    permissions: ['brand.manage', 'operations.manage'],
  }));
  const jobs = Array.from({ length: 1001 }, (_, index) => ({
    clinic_id: clinic.id, entity: 'patients', idempotency_key: `qa-import-${suffix}-${index}`,
    status: 'completed', total_rows: 2, imported_rows: 2, failed_rows: 0,
    created_by: created.user, created_at: new Date(Date.now() - index * 1000).toISOString(),
  }));
  await must('import jobs first 500', db.from('data_import_jobs').insert(jobs.slice(0, 500)));
  await must('import jobs remaining 501', db.from('data_import_jobs').insert(jobs.slice(500)));
  const { count, error: countError } = await db.from('data_import_jobs').select('id', { count: 'exact', head: true }).eq('clinic_id', clinic.id);
  if (countError || count !== 1001) throw new Error('Import fixture count mismatch');
  result.databaseJobs = count;

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
  if (!loggedIn) throw new Error('Brand admin did not reach dashboard');
  result.login = true;

  cli('goto', `${base}/admin/import`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('CSV 資料匯入') || !snapshot.includes('1001') || !snapshot.includes('2002') || !snapshot.includes('最近 20 次工作') || !snapshot.includes('20 筆')) {
    throw new Error('Import page did not reconcile 1001 jobs and 2002 imported rows with recent 20 history');
  }
  result.allJobMetricsAndRecent20 = true;

  cli('goto', `${base}/admin/settings/add-ons`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('擴充功能規劃') || !snapshot.includes('Google Calendar 雙向同步') || !snapshot.includes('等待外部帳號')) {
    throw new Error('Add-on evaluation did not render for isolated brand admin');
  }
  result.addOnEvaluation = true;
} catch (error) {
  workError = error;
} finally {
  try { cli('close'); } catch { /* fixture cleanup is independent */ }
  try { await cleanup(); result.fixtureResidual = 0; } catch (error) {
    workError = workError ? new AggregateError([workError, error], 'Browser audit and cleanup failed') : error;
  }
}

if (workError) throw workError;
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), deployment: 'e238da82-83b2-490e-a7dc-d44a92fbed55', ...result }));
