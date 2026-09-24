import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
const secret = 'PRIVATE_PROJECTION_CANARY';
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText, {exports, Error, Date, console, require: n => deps[n] ?? new Proxy({}, {get: () => '/fixture-action'})});
  return exports;
}
function fixture(page, accessType = 'brand_admin', denied = false, section = 'brand') {
  const queries = [], boundary = [], redirect = Error('NEXT_REDIRECT'); let factories = 0;
  const extra = {private: secret, access_token: secret, api_key_secret_id: secret};
  const row = {
    clinics: {name: 'Fixture Brand', slug: 'fixture', line_destination: 'public-destination', ...extra},
    clinic_settings: {booking_mode: 'time', brand_page_template: 'beauty', brand_page_content: {private: secret}, ...extra},
    clinic_payment_settings: {provider: 'ecpay', merchant_id: 'public-merchant', active: true, ...extra},
    clinic_domains: [{id: 'domain', hostname: 'fixture.invalid', verification_token: 'public-dns-proof', ...extra}],
    clinic_line_channels: {verification_status: 'ready', liff_id: 'public-liff', verification_error: secret, ...extra},
    patients: {name: 'Test Customer', line_user_id: 'public-test-target', ...extra},
  };
  const service = {from(table) {const filters = []; queries.push({table, filters}); const q = new Proxy({}, {get: (_, k) => k === 'then' ? (yes,no) => Promise.resolve({data: row[table], error: null}).then(yes,no) : (...args) => {filters.push([k,...args]); return q;}}); return q;}};
  const client = name => props => {boundary.push({name, props}); return null;};
  const deps = {
    'react/jsx-runtime': jsx,
    'next/link': {default: ({children, href}) => jsx.jsx('a', {href, children})},
    'next/headers': {headers: async () => ({get: () => null})},
    '@/components/SubmitButton': {SubmitButton: client('SubmitButton')},
    './BrandPageEditor': {BrandPageEditor: client('BrandPageEditor')},
    '@/components/PermissionPresetPicker': {BrandPermissionPicker: client('BrandPermissionPicker')},
    '@/app/admin/_components/ChannelMessagePreview': {default: client('ChannelMessagePreview')},
    '@/lib/admin': {requireAdmin: async () => {if (denied) throw redirect; return {clinicId: 'brand', accessType};}},
    '@/lib/supabase': {createServiceClient: () => {factories++; return service;}},
    '@/lib/supabase-server': {createSupabaseServer: async () => {factories++; return service;}},
    '@/lib/email': {getEmailCredentialStatus: async () => ({configured: true, source: 'vault', from: 'sender@fixture.invalid', ...extra})},
    '@/lib/payment': {getPaymentSecretStatus: async () => ({configured: true, source: 'vault', ...extra})},
    '@/lib/line-channel': {getClinicLineChannelContext: async () => ({enabled: true, liffId: 'public-liff', verificationStatus: 'ready', ...extra})},
    '@/lib/line': {lineAccessTokenForDestination: async () => secret, getLineCredentialStatus: async () => ({configured: true, source: 'vault', ...extra}), getBotInfo: async token => {assert.equal(token, secret); return {displayName: 'Fixture Bot', ...extra};}, getQuota: async () => ({type: 'limited', value: 200, ...extra}), getQuotaConsumption: async () => 20},
  };
  deps['@/lib/error-category'] = load('lib/error-category.ts', deps);
  deps['./error-category'] = deps['@/lib/error-category'];
  deps['@/lib/admin-query'] = load('lib/admin-query.ts', deps);
  deps['@/lib/delivery-error'] = load('lib/delivery-error.ts', deps);
  deps['@/lib/brand-page'] = load('lib/brand-page.ts', deps);
  deps['@/lib/access-control'] = load('lib/access-control.ts', deps);
  if (page === 'users') deps['./actions'] = new Proxy({
    listStaff: async () => [{userId: 'member', email: 'member@fixture.invalid', role: 'staff', accessType: 'employee', permissions: ['operations.manage'], assignedDoctors: [], isSelf: false, createdAt: null, ...extra}],
    listClinicDoctors: async () => [{id: 'doctor', name: 'Provider', ...extra}],
  }, {get: (o,k) => o[k] ?? '/fixture-action'});
  const api = load(`app/admin/${page}/page.tsx`, deps);
  return {queries, boundary, redirect, factories: () => factories, run: async () => {
    const tree = await api.default({searchParams: Promise.resolve({section})});
    const html = renderToStaticMarkup(tree);
    assert.ok(!html.includes(secret)); assert.ok(!JSON.stringify(boundary).includes(secret));
    return html;
  }};
}
for (const section of ['brand','page','booking','channels','domain','advanced']) for (const role of ['brand_admin','employee']) test(`settings ${section} ${role}: no private object fields in HTML or client props`, async () => {
  const h = fixture('settings', role, false, section); await h.run();
  if (section === 'page') assert.ok(h.boundary.some(x => x.name === 'BrandPageEditor'));
  for (const q of h.queries) assert.ok(q.filters.some(f => f[0] === 'eq' && f[1] === (q.table === 'clinics' ? 'id' : 'clinic_id') && f[2] === 'brand'));
});
for (const role of ['brand_admin','employee']) test(`LINE ${role}: token used server-side only`, async () => {const h = fixture('line', role); const html = await h.run(); assert.ok(h.boundary.some(x => x.name === 'ChannelMessagePreview')); assert.match(html, /LINE 官方估計剩餘/); assert.match(html, /約 180 則/);});
for (const page of ['settings','line']) test(`${page} auth redirect remains outside DB wrappers`, async () => {const h = fixture(page, 'employee', true); await assert.rejects(h.run(), e => e === h.redirect); assert.equal(h.factories(), 0);});
test('users successful page projects no full member or doctor objects to client components', async () => {const h = fixture('users'); await h.run(); assert.ok(h.boundary.some(x => x.name === 'BrandPermissionPicker'));});
