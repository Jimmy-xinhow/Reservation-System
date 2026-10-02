import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const secret = 'PRIVATE_CANARY token@example.invalid';
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {exports, Error, require: name => deps[name] ?? {}});
  return exports;
}
function fixture({fault, thrown = false, count = 1, denied = false, missing = false, mismatch = false} = {}) {
  const calls = [], ids = []; let factories = 0, active = 0, peak = 0;
  const member = i => ({user_id: `member-${i}`, role: 'staff', access_type: 'employee', permissions: ['operations.manage'], created_at: null, private: secret});
  const data = {clinic_members: Array.from({length: count}, (_, i) => member(i)), doctors: [{id: 'doctor', name: 'Provider', private: secret}], doctor_assignments: [{user_id: 'member-0', doctor_id: 'doctor', private: secret}]};
  function result(name, value) {if (fault === name) {if (thrown) throw Error(secret); return {data: null, error: {message: secret}};}return {data: value, error: null};}
  const service = {
    from(table) {
      const filters = []; calls.push({table, filters});
      const q = new Proxy({}, {get: (_, key) => key === 'then' ? (yes, no) => Promise.resolve().then(() => result(table, data[table])).then(yes, no) : (...args) => {filters.push([key, ...args]); return q;}});
      return q;
    },
    auth: {admin: {
      listUsers() {throw Error('Global Auth enumeration forbidden');},
      async getUserById(id) {ids.push(id); active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return result('auth', {user: missing ? null : {id: mismatch ? 'foreign-user' : id, email: `${id}@fixture.invalid`, user_metadata: {private: secret}}});},
    }},
  };
  const redirect = Error('NEXT_REDIRECT');
  const deps = {'@/lib/admin': {requireBrandAdmin: async () => {if (denied) throw redirect; return {user: {id: 'member-0'}, clinicId: 'brand'};}}, '@/lib/supabase': {createServiceClient() {factories++; if (fault === 'factory') throw Error(secret); return service;}}};
  deps['@/lib/error-category'] = load('lib/error-category.ts', deps);
  deps['@/lib/admin-query'] = load('lib/admin-query.ts', deps);
  deps['@/lib/access-control'] = load('lib/access-control.ts', deps);
  const api = load(process.env.STAFF_BEFORE ? 'tmp/staff-before/actions.ts' : 'app/admin/users/actions.ts', deps);
  return {api, calls, ids, redirect, factories: () => factories, peak: () => peak};
}
test('staff reads only current brand members, including accounts beyond the global first page', async () => {
  const h = fixture({count: 19}), rows = await h.api.listStaff();
  assert.equal(rows.length, 19); assert.equal(h.ids.length, 19); assert.equal(new Set(h.ids).size, 19); assert.ok(h.peak() <= 8);
  assert.equal(rows[18].email, 'member-18@fixture.invalid'); assert.equal(rows[0].assignedDoctors[0].name, 'Provider'); assert.equal(rows[0].isSelf, true);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['userId','email','role','accessType','permissions','isSelf','createdAt','assignedDoctors'].sort());
  assert.ok(!JSON.stringify(rows).includes(secret));
  for (const q of h.calls) assert.ok(q.filters.some(f => f[0] === 'eq' && f[1] === 'clinic_id' && f[2] === 'brand'));
});
test('empty brand does not enumerate Auth or providers', async () => {const h = fixture({count: 0}); assert.equal((await h.api.listStaff()).length, 0); assert.equal(h.ids.length, 0); assert.equal(h.calls.length, 1);});
for (const fault of ['clinic_members','doctors','doctor_assignments','auth']) for (const thrown of [false,true]) test(`staff ${fault} ${thrown ? 'thrown' : 'returned'} error cannot become empty/partial success`, async () => {
  const h = fixture({fault, thrown}); await assert.rejects(h.api.listStaff(), e => {assert.ok(e.message.includes('目前無法確認')); assert.ok(!e.stack.includes(secret)); return true;});
  if (fault === 'clinic_members') assert.equal(h.ids.length, 0);
});
for (const option of ['missing', 'mismatch']) test(`unresolvable member ${option} fails closed`, async () => {await assert.rejects(fixture({[option]: true}).api.listStaff(), /目前無法確認/);});
for (const method of ['listStaff','listClinicDoctors']) {
  test(`${method} preserves auth redirect before DB`, async () => {const h = fixture({denied: true}); await assert.rejects(h.api[method](), e => e === h.redirect); assert.equal(h.factories(), 0);});
  test(`${method} sanitizes factory failure`, async () => {await assert.rejects(fixture({fault: 'factory'}).api[method](), e => !e.stack.includes(secret) && e.message.includes('目前無法確認'));});
}
test('provider picker projects id/name only', async () => {const h = fixture(), rows = await h.api.listClinicDoctors(); assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{id: 'doctor', name: 'Provider'}]);});
