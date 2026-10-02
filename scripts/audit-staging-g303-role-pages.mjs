import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !serviceKey || !anonKey
  || new URL(url).host !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Staging G3-03 role-browser guard failed');
}
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const created = { clinics: [], users: [] };
const activeSessions = new Set();
const sessionRoles = new Map();
const observedRoutes = new Set();
const observedAssetPaths = new Set();
const htmlScopeMode = process.env.G303_HTML_SCOPE === '1';
const rscScopeMode = process.env.G303_RSC_SCOPE === '1';
if (rscScopeMode && !htmlScopeMode) throw new Error('G303_RSC_SCOPE requires G303_HTML_SCOPE');
const htmlScopeCounts = new Map();
const rawHtmlStatusCounts = new Map();
const rscStatusCounts = new Map();
const rscContentTypeCounts = new Map();
const positiveCanaryCounts = { dom: 0, rawHtml: 0, rsc: 0 };
const expectedDeployment = process.env.G303_EXPECTED_DEPLOYMENT;
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(expectedDeployment ?? '')) {
  throw new Error('G303_EXPECTED_DEPLOYMENT must be the active staging deployment ID');
}
const result = {
  deployment: expectedDeployment,
  mode: rscScopeMode ? 'serialized-html-rsc-scope'
    : htmlScopeMode ? 'serialized-html-scope' : 'role-assets-and-rls',
};

async function must(label, operation) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.code ?? 'unknown'}`);
  return data;
}

function cli(session, command, ...args) {
  const output = spawnSync(process.execPath, [npxCli, '--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${session}`, command, ...args], {
    encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  if (output.error || output.status !== 0) {
    const detail = command === 'eval'
      ? `${output.stdout ?? ''}\n${output.stderr ?? ''}`.replaceAll(suffix, '[fixture]')
        .replace(/09000008[0-2]0/g, '[fixture-phone]').slice(0, 1200)
      : '';
    throw new Error(`Browser ${command} failed: ${output.error?.code ?? output.status}${detail ? `\n${detail}` : ''}`);
  }
  return output.stdout;
}

function captureStaticAssets(session, route) {
  const output = cli(session, 'eval', '() => Array.from(new Set([...Array.from(document.scripts).map(s => s.src), ...performance.getEntriesByType("resource").map(e => e.name)]))');
  const match = output.match(/### Result\r?\n([\s\S]*?)\r?\n### Ran Playwright code/);
  if (!match) throw new Error('Browser static asset result missing');
  const sources = JSON.parse(match[1]);
  if (!Array.isArray(sources)) throw new Error('Browser static asset result invalid');
  for (const source of sources) {
    if (typeof source !== 'string' || !source) continue;
    const asset = new URL(source, base);
    if (asset.origin === base && /^\/_next\/static\/[a-zA-Z0-9/_-]+\.js$/.test(asset.pathname)) {
      observedAssetPaths.add(asset.pathname);
    }
  }
  observedRoutes.add(route.split('?')[0].replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]'));
}

function captureSerializedHtmlScope(session, route) {
  const role = sessionRoles.get(session);
  if (!role) throw new Error('Browser session role missing');
  const forbiddenIndexes = role === 'provider' ? [1, 2]
    : role === 'system' ? [0, 1, 2] : [2];
  const forbiddenCanaries = forbiddenIndexes.flatMap((index) => [
    `QA G303 Customer ${index} ${suffix}`,
    `09000008${index}0`,
  ]);
  const allowedCanary = role === 'system' ? null : `QA G303 Customer 0 ${suffix}`;
  const expression = `async () => {
    const forbidden = ${JSON.stringify(forbiddenCanaries)};
    const allowed = ${JSON.stringify(allowedCanary)};
    const dom = document.documentElement.outerHTML;
    const response = await fetch(${JSON.stringify(route)}, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { Accept: 'text/html' },
    });
    const rawHtml = await response.text();
    const rscResponse = ${rscScopeMode ? `await fetch(${JSON.stringify(route)}, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { RSC: '1', Accept: 'text/x-component' },
    })` : 'null'};
    const rscBody = rscResponse ? await rscResponse.text() : '';
    return {
      dom: forbidden.map(value => dom.includes(value)),
      rawHtml: forbidden.map(value => rawHtml.includes(value)),
      rsc: forbidden.map(value => rscBody.includes(value)),
      status: response.status,
      rscStatus: rscResponse ? rscResponse.status : null,
      rscContentType: rscResponse ? rscResponse.headers.get('content-type') : null,
      positiveDom: allowed ? dom.includes(allowed) : false,
      positiveRawHtml: allowed ? rawHtml.includes(allowed) : false,
      positiveRsc: allowed ? rscBody.includes(allowed) : false,
    };
  }`.replace(/\r?\n\s*/g, ' ');
  const output = cli(session, 'eval', expression);
  const match = output.match(/### Result\r?\n([\s\S]*?)\r?\n### Ran Playwright code/);
  if (!match) throw new Error('Browser serialized HTML result missing');
  const findings = JSON.parse(match[1]);
  if (!findings || typeof findings.status !== 'number'
    || !['dom', 'rawHtml', 'rsc'].every((source) => Array.isArray(findings[source])
      && findings[source].length === forbiddenCanaries.length
      && findings[source].every((value) => typeof value === 'boolean'))
    || typeof findings.positiveDom !== 'boolean'
    || typeof findings.positiveRawHtml !== 'boolean'
    || typeof findings.positiveRsc !== 'boolean'
    || (rscScopeMode && (typeof findings.rscStatus !== 'number'
      || typeof findings.rscContentType !== 'string'))) {
    throw new Error('Browser serialized HTML result invalid');
  }
  const normalizedRoute = route.split('?')[0].replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]');
  if (findings.dom.some(Boolean) || findings.rawHtml.some(Boolean)
    || (rscScopeMode && findings.rsc.some(Boolean))) {
    throw new Error(`Forbidden synthetic customer data serialized for ${role} at ${normalizedRoute}`);
  }
  htmlScopeCounts.set(role, (htmlScopeCounts.get(role) ?? 0) + 1);
  rawHtmlStatusCounts.set(findings.status, (rawHtmlStatusCounts.get(findings.status) ?? 0) + 1);
  if (findings.positiveDom) positiveCanaryCounts.dom += 1;
  if (findings.positiveRawHtml) positiveCanaryCounts.rawHtml += 1;
  if (rscScopeMode) {
    rscStatusCounts.set(findings.rscStatus, (rscStatusCounts.get(findings.rscStatus) ?? 0) + 1);
    const contentType = findings.rscContentType.split(';')[0];
    rscContentTypeCounts.set(contentType, (rscContentTypeCounts.get(contentType) ?? 0) + 1);
    if (findings.positiveRsc) positiveCanaryCounts.rsc += 1;
  }
  observedRoutes.add(normalizedRoute);
}

function ref(snapshot, pattern) {
  const match = snapshot.match(pattern);
  if (!match) throw new Error(`Expected browser control missing: ${pattern.source}`);
  return match[1];
}

function fillCurrent(session, snapshot, pattern, value) {
  try {
    cli(session, 'fill', ref(snapshot, pattern), value);
  } catch {
    // A client-side rerender can invalidate the observed ref. Reobserve once.
    cli(session, 'fill', ref(cli(session, 'snapshot'), pattern), value);
  }
}

function closeSession(session) {
  cli(session, 'close');
  activeSessions.delete(session);
  sessionRoles.delete(session);
}

async function createUser(role) {
  const email = `qa-g303-roles-${role}-${suffix}@example.invalid`;
  const password = `${randomBytes(20).toString('base64url')}Aa1!`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Create ${role} Auth user failed`);
  created.users.push(data.user.id);
  return { id: data.user.id, email, password };
}

function login(role, user, entry) {
  const session = `g303role${role}${randomBytes(3).toString('hex')}`;
  activeSessions.add(session);
  sessionRoles.set(session, role);
  cli(session, 'open', `${base}/admin/login`);
  let snapshot = cli(session, 'snapshot');
  if (entry === 'platform') {
    cli(session, 'click', ref(snapshot, /button "系統管理後台" \[ref=([a-zA-Z0-9]+)\]/));
    snapshot = cli(session, 'snapshot');
  }
  fillCurrent(session, snapshot, /textbox "Email" \[ref=([a-zA-Z0-9]+)\]/, user.email);
  snapshot = cli(session, 'snapshot');
  fillCurrent(session, snapshot, /textbox "密碼" \[ref=([a-zA-Z0-9]+)\]/, user.password);
  snapshot = cli(session, 'snapshot');
  cli(session, 'click', ref(snapshot, /button "進入(?:品牌營運|系統管理)" \[ref=([a-zA-Z0-9]+)\]/));
  const expectedPath = entry === 'platform' ? '/admin/platform' : '/admin/dashboard';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    snapshot = cli(session, 'snapshot');
    if (snapshot.includes(`Page URL: ${base}${expectedPath}`)) {
      if (htmlScopeMode) captureSerializedHtmlScope(session, expectedPath);
      else captureStaticAssets(session, expectedPath);
      return session;
    }
  }
  throw new Error(`${role} did not reach authorized workspace`);
}

function visit(session, path) {
  cli(session, 'goto', `${base}${path}`);
  const snapshot = cli(session, 'snapshot');
  if (htmlScopeMode) captureSerializedHtmlScope(session, path);
  else captureStaticAssets(session, path);
  return snapshot;
}

function settledDeniedBrandSnapshot(session, path) {
  let snapshot = visit(session, path);
  for (let attempt = 0; attempt < 6 && (!snapshot.includes(`Page URL: ${base}/admin/dashboard?notice=permission`)
    || !snapshot.includes('員工權限未包含')); attempt += 1) {
    snapshot = cli(session, 'snapshot');
  }
  if (htmlScopeMode) captureSerializedHtmlScope(session, '/admin/dashboard?notice=permission');
  return snapshot;
}

function visitDeniedBrandPage(session, path) {
  const snapshot = settledDeniedBrandSnapshot(session, path);
  return snapshot.includes(`Page URL: ${base}/admin/dashboard?notice=permission`)
    && snapshot.includes('員工權限未包含');
}

function verify(label, condition) {
  if (!condition) throw new Error(`${label} failed`);
  result[label] = true;
}

async function cleanup() {
  const errors = [];
  for (const session of activeSessions) {
    try { cli(session, 'close'); } catch { /* DB cleanup is independent */ }
  }
  for (const clinic of created.clinics) {
    const found = await must('verify QA brand', service.from('clinics').select('slug').eq('id', clinic.id).maybeSingle());
    if (!found) continue;
    if (found.slug !== clinic.slug) throw new Error('QA brand identity mismatch');
    for (const table of [
      'admin_product_events', 'appointment_status_events', 'appointment_notification_logs',
      'reminder_logs', 'crm_interactions', 'appointments', 'doctor_assignments',
      'doctors', 'patients', 'clinic_members', 'attendance_settings',
      'clinic_line_channels', 'brand_entitlements', 'clinic_activation_metrics',
      'clinic_settings', 'clinics',
    ]) {
      const { error } = await service.from(table).delete().eq(table === 'clinics' ? 'id' : 'clinic_id', clinic.id);
      if (error) errors.push(`${table}:${error.code ?? 'unknown'}`);
    }
  }
  for (const userId of created.users) {
    const { error: roleError } = await service.from('platform_admins').delete().eq('user_id', userId);
    if (roleError) errors.push(`platform_admins:${roleError.code ?? 'unknown'}`);
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) errors.push(`Auth:${error.status ?? 'unknown'}`);
  }
  if (errors.length) throw new Error(`Fixture cleanup failed: ${errors.join(',')}`);
  for (const clinic of created.clinics) {
    const { count, error } = await service.from('clinics').select('id', { count: 'exact', head: true }).eq('id', clinic.id);
    if (error || count !== 0) throw new Error('QA brand remains');
  }
  for (const userId of created.users) {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (!error || data?.user) throw new Error('QA Auth user remains');
  }
}

let workError;
try {
  for (const kind of ['own', 'foreign']) {
    const slug = `qa-g303-roles-${kind}-${suffix}`;
    const clinic = await must(`${kind} clinic`, service.from('clinics').insert({
      name: `QA G303 Roles ${kind} ${suffix}`, slug, active: true,
    }).select('id').single());
    created.clinics.push({ id: clinic.id, slug });
  }
  const [own, foreign] = created.clinics;
  // New brands keep optional events disabled; enable only this QA brand to test the authorized list.
  await must('enable QA events module', service.from('clinic_settings')
    .update({ events_enabled: true }).eq('clinic_id', own.id).select('clinic_id').single());
  const doctors = [];
  const patients = [];
  const viewDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })
    .format(new Date(Date.now() + 2 * 86400000));
  for (const [index, clinicId] of [own.id, own.id, foreign.id].entries()) {
    const doctor = await must('doctor', service.from('doctors').insert({
      clinic_id: clinicId, name: `QA G303 Provider ${index} ${suffix}`, active: true,
    }).select('id').single());
    const patient = await must('patient', service.from('patients').insert({
      clinic_id: clinicId, name: `QA G303 Customer ${index} ${suffix}`, phone: `09000008${index}0`,
    }).select('id').single());
    doctors.push(doctor.id);
    patients.push(patient.id);
    const start = new Date(`${viewDate}T${10 + index}:00:00+08:00`);
    await must('appointment', service.from('appointments').insert({
      clinic_id: clinicId, doctor_id: doctor.id, patient_id: patient.id,
      start_at: start.toISOString(), end_at: new Date(start.getTime() + 1800000).toISOString(),
      status: 'booked',
    }));
  }
  const staff = await createUser('staff');
  const provider = await createUser('provider');
  const system = await createUser('system');
  const brandAdmin = await createUser('brand-admin');
  for (const [user, role, permission] of [
    [staff, 'staff', 'operations.manage'], [provider, 'provider', 'provider.assigned'],
  ]) {
    await must('brand membership', service.from('clinic_members').insert({
      clinic_id: own.id, user_id: user.id, role, access_type: 'employee', permissions: [permission],
    }));
  }
  await must('brand admin membership', service.from('clinic_members').insert({
    clinic_id: own.id, user_id: brandAdmin.id, role: 'admin', access_type: 'brand_admin',
    permissions: ['brand.manage', 'operations.manage'],
  }));
  await must('provider assignment', service.from('doctor_assignments').insert({
    clinic_id: own.id, user_id: provider.id, doctor_id: doctors[0], active: true,
  }));
  await must('system permission', service.from('platform_admins').insert({
    user_id: system.id, role: 'admin', access_type: 'employee', permissions: ['platform.overview'], active: true,
  }));

  const staffSession = login('staff', staff, 'brand');
  let snapshot = visit(staffSession, '/admin/dashboard');
  verify('staffDashboardOwnOnly', snapshot.includes(`QA G303 Provider 0 ${suffix}`)
    && snapshot.includes(`QA G303 Provider 1 ${suffix}`) && !snapshot.includes(`QA G303 Provider 2 ${suffix}`));
  snapshot = visit(staffSession, '/admin/patients');
  verify('staffPatientsOwnOnly', snapshot.includes(`QA G303 Customer 0 ${suffix}`)
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(staffSession, `/admin/patients/${patients[0]}`);
  verify('staffOwnPatientDetailAllowed', snapshot.includes(`QA G303 Customer 0 ${suffix}`)
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(staffSession, `/admin/patients/${patients[2]}`);
  verify('staffForeignPatientDetailDenied', snapshot.includes('查無此顧客')
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(staffSession, `/admin?date=${viewDate}`);
  verify('staffTodayOwnOnly', snapshot.includes(`QA G303 Customer 0 ${suffix}`)
    && snapshot.includes(`QA G303 Customer 1 ${suffix}`)
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(staffSession, `/admin/reports?from=${viewDate}&to=${viewDate}`);
  verify('staffReportsOwnOnly', snapshot.includes('預約紀錄')
    && snapshot.includes(`QA G303 Provider 0 ${suffix}`)
    && snapshot.includes(`QA G303 Provider 1 ${suffix}`)
    && !snapshot.includes(`QA G303 Provider 2 ${suffix}`));
  snapshot = settledDeniedBrandSnapshot(staffSession, '/admin/settings');
  result.staffSettingsObserved = {
    route: snapshot.match(/Page URL: (https?:\/\/\S+)/)?.[1]?.replace(base, '') ?? 'unknown',
    permissionNotice: snapshot.includes('員工權限未包含'),
    settingsHeading: snapshot.includes('品牌設定'),
  };
  verify('staffSettingsDenied', result.staffSettingsObserved.permissionNotice
    && !result.staffSettingsObserved.settingsHeading);
  snapshot = visit(staffSession, '/admin/platform');
  verify('staffPlatformDenied', snapshot.includes('此帳號沒有系統管理後台權限')
    && !snapshot.includes('系統管理控制台'));
  snapshot = visit(staffSession, '/admin/checkout');
  verify('staffCheckoutAllowed', snapshot.includes('結帳中心') && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(staffSession, '/admin/registrations');
  verify('staffRegistrationsAllowed', snapshot.includes('報名名單')
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(staffSession, '/admin/operations/finance');
  verify('staffFinanceAllowed', snapshot.includes('財務摘要')
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(staffSession, '/admin/users');
  verify('staffUsersDenied', snapshot.includes('員工權限未包含') && !snapshot.includes('員工與權限'));
  snapshot = visit(staffSession, '/admin/services');
  verify('staffServicesDenied', snapshot.includes('員工權限未包含') && !snapshot.includes('服務方案與排程設定'));
  snapshot = visit(staffSession, '/admin/platform/operations');
  verify('staffPlatformOperationsDenied', snapshot.includes('此帳號沒有系統管理後台權限')
    && !snapshot.includes('最近全域排程'));
  closeSession(staffSession);

  const providerSession = login('provider', provider, 'brand');
  snapshot = visit(providerSession, '/admin/dashboard');
  verify('providerDashboardAssignedOnly', snapshot.includes('我的今日工作台')
    && snapshot.includes(`QA G303 Provider 0 ${suffix}`)
    && !snapshot.includes(`QA G303 Provider 1 ${suffix}`)
    && !snapshot.includes(`QA G303 Provider 2 ${suffix}`));
  snapshot = visit(providerSession, `/admin?date=${viewDate}`);
  verify('providerTodayAssignedOnly', snapshot.includes(`QA G303 Customer 0 ${suffix}`)
    && !snapshot.includes(`QA G303 Customer 1 ${suffix}`)
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(providerSession, '/admin/patients');
  verify('providerPatientsLimited', snapshot.includes('目前角色只能查看被分配的工作')
    && !snapshot.includes(`QA G303 Customer 0 ${suffix}`));
  snapshot = visit(providerSession, `/admin/patients/${patients[0]}`);
  verify('providerOwnPatientDetailDenied', snapshot.includes('目前角色沒有查看完整顧客資料的權限')
    && !snapshot.includes(`QA G303 Customer 0 ${suffix}`));
  snapshot = visit(providerSession, `/admin/patients/${patients[2]}`);
  verify('providerForeignPatientDetailDenied', snapshot.includes('目前角色沒有查看完整顧客資料的權限')
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(providerSession, '/admin/settings');
  if (!snapshot.includes('員工權限未包含')) snapshot = cli(providerSession, 'snapshot');
  result.providerSettingsObserved = {
    route: snapshot.match(/Page URL: (https?:\/\/\S+)/)?.[1]?.replace(base, '') ?? 'unknown',
    permissionNotice: snapshot.includes('員工權限未包含'),
    settingsHeading: snapshot.includes('品牌與系統設定'),
  };
  verify('providerSettingsDenied', snapshot.includes('員工權限未包含') && !snapshot.includes('品牌設定'));
  snapshot = visit(providerSession, `/admin/reports?from=${viewDate}&to=${viewDate}`);
  verify('providerReportsDenied', snapshot.includes('員工權限未包含') && !snapshot.includes('預約明細分組'));
  snapshot = visit(providerSession, '/admin/checkout');
  verify('providerCheckoutDenied', snapshot.includes('員工權限未包含') && !snapshot.includes('結帳中心'));
  snapshot = visit(providerSession, '/admin/handoff');
  if (!snapshot.includes('員工權限未包含')) snapshot = cli(providerSession, 'snapshot');
  verify('providerHandoffDenied', snapshot.includes('員工權限未包含') && !snapshot.includes('交班待辦'));
  for (const [label, path, forbidden] of [
    ['providerInventoryDenied', '/admin/operations/inventory', '耗材與商品庫存'],
    ['providerCommissionsDenied', '/admin/operations/commissions', '服務獎金試算'],
    ['providerServiceRecordsDenied', '/admin/operations/service-records', '服務過程紀錄'],
  ]) {
    snapshot = visit(providerSession, path);
    if (!snapshot.includes('員工權限未包含')) snapshot = cli(providerSession, 'snapshot');
    verify(label, snapshot.includes('員工權限未包含') && !snapshot.includes(forbidden));
  }
  snapshot = visit(providerSession, '/admin/users');
  verify('providerUsersDenied', snapshot.includes('員工權限未包含') && !snapshot.includes('員工與權限'));
  for (const [label, path] of [
    ['providerRegistrationsDenied', '/admin/registrations'],
    ['providerFinanceDenied', '/admin/operations/finance'],
    ['providerLineDenied', '/admin/line'],
    ['providerChannelsDenied', '/admin/channels'],
    ['providerProductsDenied', '/admin/products'],
  ]) {
    verify(label, visitDeniedBrandPage(providerSession, path));
  }
  closeSession(providerSession);

  const brandAdminSession = login('brandadmin', brandAdmin, 'brand');
  snapshot = visit(brandAdminSession, '/admin/dashboard');
  verify('brandAdminDashboardOwnOnly', snapshot.includes(`QA G303 Provider 0 ${suffix}`)
    && !snapshot.includes(`QA G303 Provider 2 ${suffix}`));
  snapshot = visit(brandAdminSession, `/admin/patients/${patients[0]}`);
  verify('brandAdminOwnPatientDetailAllowed', snapshot.includes(`QA G303 Customer 0 ${suffix}`)
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(brandAdminSession, `/admin/patients/${patients[2]}`);
  verify('brandAdminForeignPatientDetailDenied', snapshot.includes('查無此顧客')
    && !snapshot.includes(`QA G303 Customer 2 ${suffix}`));
  snapshot = visit(brandAdminSession, '/admin/settings');
  verify('brandAdminSettingsAllowed', snapshot.includes('品牌與系統設定')
    && !snapshot.includes('員工權限未包含'));
  snapshot = visit(brandAdminSession, '/admin/users');
  verify('brandAdminUsersAllowed', snapshot.includes('員工與權限')
    && !snapshot.includes('員工權限未包含'));
  snapshot = visit(brandAdminSession, '/admin/services');
  verify('brandAdminServicesAllowed', snapshot.includes('服務方案與排程設定')
    && !snapshot.includes('員工權限未包含'));
  snapshot = visit(brandAdminSession, '/admin/platform');
  verify('brandAdminPlatformDenied', snapshot.includes('此帳號沒有系統管理後台權限')
    && !snapshot.includes('系統管理控制台'));
  closeSession(brandAdminSession);

  const systemSession = login('system', system, 'platform');
  snapshot = visit(systemSession, '/admin/platform');
  verify('systemOverviewOnly', snapshot.includes('系統管理控制台')
    && snapshot.includes('品牌交付狀態') && !snapshot.includes('建立新品牌'));
  snapshot = visit(systemSession, '/admin/platform/reports');
  verify('systemReportsDenied', snapshot.includes('系統員工權限未包含')
    && !snapshot.includes('跨品牌使用量摘要'));
  snapshot = visit(systemSession, '/admin/dashboard');
  verify('systemBrandDashboardDenied', snapshot.includes('此帳號沒有品牌營運後台權限')
    && !snapshot.includes(`QA G303 Customer 0 ${suffix}`));
  for (const [label, path] of [
    ['systemOperationsDenied', '/admin/platform/operations'],
    ['systemAuditDenied', '/admin/platform/audit'],
    ['systemSettingsDenied', '/admin/platform/settings'],
    ['systemAdminsDenied', '/admin/platform/admins'],
  ]) {
    snapshot = visit(systemSession, path);
    if (!snapshot.includes('系統員工權限未包含')) snapshot = cli(systemSession, 'snapshot');
    verify(label, snapshot.includes(`Page URL: ${base}/admin/platform?notice=permission`)
      && snapshot.includes('系統員工權限未包含'));
  }
  closeSession(systemSession);

  if (!htmlScopeMode) {
  const staffClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const staffSignIn = await staffClient.auth.signInWithPassword({ email: staff.email, password: staff.password });
  if (staffSignIn.error) throw new Error(`Staff API sign-in failed: ${staffSignIn.error.status ?? 'unknown'}/${staffSignIn.error.code ?? 'unknown'}`);
  const { data: foreignRows, error: foreignError } = await staffClient.from('patients').select('id').eq('clinic_id', foreign.id);
  verify('staffCrossBrandRlsDenied', !foreignError && foreignRows.length === 0);
  const { data: foreignAppointments, error: foreignAppointmentsError } = await staffClient.from('appointments')
    .select('id').eq('clinic_id', foreign.id);
  verify('staffCrossBrandAppointmentsDenied', !foreignAppointmentsError && foreignAppointments.length === 0);
  await staffClient.auth.signOut();

  const adminClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminSignIn = await adminClient.auth.signInWithPassword({ email: brandAdmin.email, password: brandAdmin.password });
  if (adminSignIn.error) throw new Error(`Brand admin API sign-in failed: ${adminSignIn.error.status ?? 'unknown'}/${adminSignIn.error.code ?? 'unknown'}`);
  const { data: ownRows, error: ownError } = await adminClient.from('patients').select('id').eq('clinic_id', own.id);
  verify('brandAdminOwnPatientRlsAllowed', !ownError && ownRows.length === 2);
  const { data: foreignAdminRows, error: foreignAdminError } = await adminClient.from('patients')
    .select('id').eq('clinic_id', foreign.id);
  verify('brandAdminCrossBrandPatientRlsDenied', !foreignAdminError && foreignAdminRows.length === 0);
  const { data: ownAppointments, error: ownAppointmentsError } = await adminClient.from('appointments')
    .select('id').eq('clinic_id', own.id);
  verify('brandAdminOwnAppointmentRlsAllowed', !ownAppointmentsError && ownAppointments.length === 2);
  const { data: foreignAdminAppointments, error: foreignAdminAppointmentsError } = await adminClient.from('appointments')
    .select('id').eq('clinic_id', foreign.id);
  verify('brandAdminCrossBrandAppointmentRlsDenied', !foreignAdminAppointmentsError && foreignAdminAppointments.length === 0);
  await adminClient.auth.signOut();
  } else {
    result.directRls = 'not-run-in-html-scope-mode';
    const checks = [...htmlScopeCounts.values()].reduce((sum, count) => sum + count, 0);
    if (checks < 30) throw new Error(`Serialized HTML scope incomplete: ${checks} page observations`);
  }
} catch (error) {
  workError = error;
} finally {
  try { await cleanup(); result.fixtureResidual = 0; } catch (error) {
    workError = workError ? new AggregateError([workError, error], 'Role audit and cleanup failed') : error;
  }
}
result.authenticatedRoutes = [...observedRoutes].sort();
result.authenticatedAssetPaths = [...observedAssetPaths].sort();
if (htmlScopeMode) {
  result.htmlScopeChecksByRole = Object.fromEntries(htmlScopeCounts);
  result.htmlScopeChecksTotal = [...htmlScopeCounts.values()].reduce((sum, count) => sum + count, 0);
  result.rawHtmlStatusCounts = Object.fromEntries(rawHtmlStatusCounts);
  result.positiveCanaryCounts = positiveCanaryCounts;
  if (rscScopeMode) {
    result.rscStatusCounts = Object.fromEntries(rscStatusCounts);
    result.rscContentTypeCounts = Object.fromEntries(rscContentTypeCounts);
  }
}
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), base, ...result }, null, 2));
if (workError) throw workError;
