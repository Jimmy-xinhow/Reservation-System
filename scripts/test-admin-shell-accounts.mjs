import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
const canary = 'PRIVATE_SHELL_CANARY';
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText, {exports, Error, Date, Intl, console, process: {env: {CRON_SECRET: canary, PAYMENT_SECRETS_JSON: canary}}, require: n => deps[n] ?? {}});
  return exports;
}
function harness({role = 'brand_admin', fault = '', thrown = false, code = 'XX000', denied = false, empty = false} = {}) {
  const queries = [], ids = [], boundaries = []; let factories = 0, active = 0, peak = 0;
  const redirect = Error('NEXT_REDIRECT');
  const extra = {private: canary, raw_app_meta_data: {token: canary}};
  const rows = {
    attendance_settings: {click_enabled: true, qr_enabled: true, line_enabled: false, qr_refresh_seconds: 60, ...extra},
    attendance_staff: [{user_id: 'self', display_name: 'Fixture Staff', line_user_id: 'intended-line-id', active: true, ...extra}],
    attendance_events: [{id: 'event', user_id: 'self', event_type: 'clock_in', occurred_at: '2026-09-23T00:00:00Z', method: 'button', ...extra}],
    clinic_members: empty ? [] : [{user_id: 'self', access_type: 'brand_admin', ...extra}, {user_id: 'later-account', access_type: 'employee', ...extra}],
    platform_admins: empty ? [] : [{user_id: 'self', access_type: 'system_admin', permissions: [], active: true, created_at: '2026-09-01', ...extra}, {user_id: 'later-account', access_type: 'employee', permissions: ['settings.view'], active: true, created_at: '2026-09-01', ...extra}],
    clinic_settings: {events_enabled: true, memberships_enabled: false, line_channel_enabled: true, ...extra},
  };
  const service = {from(table, session = false) {const filters = []; queries.push({table, filters}); const q = new Proxy({}, {get: (_, k) => k === 'then' ? (yes,no) => Promise.resolve().then(() => {if (fault === table) {if (thrown) throw Error(canary); return {data: null, error: {message: canary, code}};}return {data: session && table === 'clinic_members' ? rows[table].filter(row => row.user_id === 'self') : rows[table] ?? [], count: 1, error: null};}).then(yes,no) : (...args) => {filters.push([k,...args]); return q;}});return q;}, auth: {admin: {
    listUsers() {throw Error('global-enumeration-forbidden');},
    async getUserById(id) {ids.push(id); active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; if (fault === 'auth') {if (thrown) throw Error(canary); return {data: null, error: {message: canary}};}return {data: {user: fault === 'missing' ? null : {id: fault === 'mismatch' ? 'foreign' : id, email: `${id}@fixture.invalid`, ...extra}}, error: null};},
  }}};
  const member = {user: {id: 'self', email: 'self@fixture.invalid', ...extra}, clinicId: 'brand', clinicName: 'Fixture Brand', accessType: role, role: role === 'provider' ? 'provider' : 'admin', permissions: ['brand.manage'], clinics: [{id: 'brand', name: 'Fixture Brand', ...extra}, {id: 'second', name: 'Second Brand', ...extra}], supabase: {...service, from: table => service.from(table, true)}, ...extra};
  const gate = async () => {if (denied) throw redirect; return member;};
  const client = name => props => {boundaries.push({name, props}); return null;};
  const deps = {
    'react/jsx-runtime': jsx,
    'next/link': {default: ({children, href}) => jsx.jsx('a', {href, children})},
    'next/headers': {headers: async () => ({get: () => '/admin/dashboard'})},
    '@/lib/admin': {requireMember: gate, getOptionalMember: gate},
    '@/lib/platform': {requireSystemAdmin: gate, requireSystemPermission: gate, getOptionalPlatformAdmin: async () => null},
    '@/lib/supabase': {createServiceClient: () => {factories++; if (fault === 'factory') throw Error(canary); return service;}},
    '@/components/SubmitButton': {SubmitButton: client('SubmitButton')},
    '@/components/TechnicalDetails': {TechnicalDetails: client('TechnicalDetails')},
    '@/components/PermissionPresetPicker': {SystemPermissionPicker: client('SystemPermissionPicker')},
    '../handoff/AttendancePanels': {AttendanceClockPanel: client('AttendanceClockPanel'), AttendanceQrBoard: client('AttendanceQrBoard')},
    '@/components/AdminNav': {AdminNav: client('AdminNav')},
    '@/components/Brand': {Brand: client('Brand')},
    '@/components/AdminProductTelemetry': {AdminProductTelemetry: client('AdminProductTelemetry')},
  };
  for (const [name,path] of [['error-category','lib/error-category.ts'],['admin-query','lib/admin-query.ts'],['admin-account-summaries','lib/admin-account-summaries.ts'],['access-control','lib/access-control.ts'],['platform-roles','lib/platform-roles.ts']]) deps['@/lib/'+name] = load(path, deps);
  const paths = {attendance: 'app/admin/attendance/page.tsx', people: 'app/admin/platform/admins/page.tsx', layout: 'app/admin/layout.tsx', settings: 'app/admin/platform/settings/page.tsx'};
  return {queries, ids, boundaries, deps, member, service, redirect, factories: () => factories, peak: () => peak, async run(page) {
    const before = {attendance: 'attendance.tsx', people: 'platform-admins.tsx', layout: 'layout.tsx'};
    const path = process.env.SHELL_BEFORE && before[page] ? 'tmp/shell-before/'+before[page] : paths[page];
    const tree = await load(path,deps).default({searchParams: Promise.resolve({from: '2026-09-01', to: '2026-09-23'}), children: 'Fixture Content'});
    const html = renderToStaticMarkup(tree); assert.ok(!html.includes(canary)); assert.ok(!JSON.stringify(boundaries).includes(canary)); return html;
  }};
}
for (const page of ['attendance','people']) {
  test(`${page} only resolves scoped member IDs and excludes private metadata`, async () => {const h = harness(); const html = await h.run(page); assert.deepEqual(h.ids.sort(), ['later-account','self']); assert.ok(html.includes('later-account@fixture.invalid')); if (page === 'attendance') for (const q of h.queries) assert.ok(q.filters.some(f => f[0] === 'eq' && f[1] === 'clinic_id' && f[2] === 'brand'));});
  test(`${page} empty membership never enumerates Auth`, async () => {const h = harness({empty: true}); await h.run(page); assert.equal(h.ids.length, 0);});
  for (const thrown of [true,false]) test(`${page} Auth ${thrown?'throw':'returned error'} never becomes partial success`, async () => {const h = harness({fault: 'auth', thrown}); await assert.rejects(h.run(page), e => e.message.includes('目前無法確認') && !e.stack.includes(canary));});
  test(`${page} preserves role gate before reads`, async () => {const h = harness({denied: true}); await assert.rejects(h.run(page), e => e === h.redirect); assert.equal(h.factories(), 0); assert.equal(h.queries.length, 0);});
  test(`${page} factory failure is sanitized`, async () => {await assert.rejects(harness({fault: 'factory'}).run(page), e => e.message.includes('目前無法確認') && !e.stack.includes(canary));});
}
for (const table of ['attendance_settings','attendance_staff','attendance_events','clinic_members']) for (const code of ['XX000','42P01']) test(`attendance ${table} ${code} cannot display fabricated default or empty success`, async () => {const h = harness({fault: table, code}); await assert.rejects(h.run('attendance'), /目前無法確認/); assert.equal(h.ids.length, 0);});
test('platform membership failure prevents all Auth reads', async () => {const h = harness({fault: 'platform_admins'}); await assert.rejects(h.run('people'), /目前無法確認/); assert.equal(h.ids.length, 0);});
for (const role of ['employee','provider']) test(`attendance ${role} only reads own events without bindings or Auth`, async () => {const h = harness({role}); const html = await h.run('attendance'); assert.equal(h.ids.length, 0); assert.ok(!h.queries.some(q => ['attendance_staff','clinic_members'].includes(q.table))); const q=h.queries.find(q=>q.table==='attendance_events'); assert.ok(q.filters.some(f=>f[0]==='eq'&&f[1]==='user_id'&&f[2]==='self')); assert.ok(!html.includes('intended-line-id'));});
for (const fault of ['missing','mismatch']) test(`account helper ${fault} fails closed`, async () => {const h = harness({fault}); await assert.rejects(h.deps['@/lib/admin-account-summaries'].readAdminAccountSummaries(h.service,['self']), /目前無法確認/);});
test('account helper deduplicates IDs, bounds concurrency and returns allowlisted summary', async () => {const h = harness(), ids=Array.from({length:19},(_,i)=>`u-${i}`); const result=await h.deps['@/lib/admin-account-summaries'].readAdminAccountSummaries(h.service,[...ids,...ids]); assert.equal(h.ids.length,19); assert.ok(h.peak()<=8); assert.equal(result.size,19); assert.deepEqual(Object.keys(result.get('u-18')).sort(),['email','emailConfirmedAt','invitedAt','lastSignInAt'].sort()); assert.ok(!JSON.stringify([...result]).includes(canary));});
test('brand layout passes only navigation identity and module flags', async () => {const h=harness({role:'employee'});await h.run('layout');const nav=h.boundaries.find(x=>x.name==='AdminNav');assert.equal(nav.props.brandAccessType,'employee');assert.equal(nav.props.modules.events,true);assert.equal(nav.props.modules.memberships,false);assert.ok(!('user' in nav.props));assert.ok(!('supabase' in nav.props));});
test('platform settings emits only configured booleans, not environment keys', async()=>{const h=harness();await h.run('settings');assert.equal(h.queries.length,3);for(const q of h.queries)assert.ok(q.filters.some(f=>f[0]==='select'&&f[2]?.head===true));});
function navigation(accessType, role='admin', platform=false) {
  const deps={'react/jsx-runtime':jsx,'react':{useState:v=>[v,()=>{}],useEffect:()=>{}},'next/navigation':{usePathname:()=>platform?'/admin/platform':'/admin/users'}};
  const path=process.env.SHELL_BEFORE?'tmp/shell-before/AdminNav.tsx':'components/AdminNav.tsx';
  const tree=load(path,deps).AdminNav({role,brandAccessType:accessType,isPlatformAdmin:platform,platformAccessType:platform?'system_admin':null,hasBrandContext:!platform});
  let groups;function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}if(n.props?.groups)groups=n.props.groups;walk(n.props?.children);}walk(tree);assert.ok(groups);return groups.flatMap(g=>g.items.map(i=>i.href));
}
test('brand settings employee does not see people management but keeps brand settings',()=>{const links=navigation('employee');assert.ok(!links.includes('/admin/users'));assert.ok(links.includes('/admin/settings'));});
test('brand administrator retains people management',()=>{assert.ok(navigation('brand_admin').includes('/admin/users'));});
test('missing management identity fails closed for people navigation',()=>{assert.ok(!navigation(undefined).includes('/admin/users'));});
test('provider retains assigned-work navigation only',()=>{const links=navigation('employee','provider');assert.ok(links.includes('/admin/calendar'));assert.ok(!links.includes('/admin/users'));assert.ok(!links.includes('/admin/settings'));});
test('system administrator retains system people navigation only',()=>{const links=navigation(null,'owner',true);assert.ok(links.includes('/admin/platform/admins'));assert.ok(!links.includes('/admin/users'));});
