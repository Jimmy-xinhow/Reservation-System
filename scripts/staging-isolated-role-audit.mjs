// G3-02 audit. Creates three temporary employee Auth users only after explicit approval.
// Credentials stay in process memory; exact fixture IDs are cleaned in finally.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

assert.equal(process.env.RAILWAY_ENVIRONMENT_NAME, 'staging');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'ongjsegewpnbkqugrpom.supabase.co');
assert.equal(process.env.G302_TEMP_ROLE_APPROVED, 'yes', 'Explicit approval for temporary isolated role accounts is required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const fixtures = [], users = [], clients = [], checks = [];
const must = async (query) => { const result = await query; if (result.error) throw Error(result.error.message); return result.data; };
const check = (name, value) => { checks.push({ name, passed: Boolean(value) }); assert.ok(value, name); console.log('PASS ' + name); };
const insert = async (table, data) => (await must(service.from(table).insert(data).select('id').single())).id;
let failure = null;
const cleanupErrors = [];
try {
  for (let i = 0; i < 2; i++) {
    const f = { id: randomUUID(), slug: 'qa-g302-role-' + randomUUID(), patients: [], doctors: [], appointments: [] };
    fixtures.push(f);
    await must(service.from('clinics').insert({ id: f.id, slug: f.slug, name: 'G302隔離角色驗收' }));
    await must(service.from('clinic_settings').update({ line_channel_enabled: false, email_enabled: false, crm_automation_enabled: false }).eq('clinic_id', f.id));
    for (let j = 0; j < 2; j++) {
      f.patients.push(await insert('patients', { clinic_id: f.id, name: 'G302合成顧客' + j, phone: '09000006' + i + j, marketing_opt_in: false }));
      f.doctors.push(await insert('doctors', { clinic_id: f.id, name: 'G302合成人員' + j }));
      f.appointments.push(await insert('appointments', { clinic_id: f.id, doctor_id: f.doctors[j], patient_id: f.patients[j], start_at: new Date(Date.now() + 7 * 86400000).toISOString(), end_at: new Date(Date.now() + 7 * 86400000 + 1800000).toISOString() }));
    }
  }
  const [own, foreign] = fixtures;
  for (const role of ['staff', 'provider']) {
    const email = 'qa-g302-' + role + '-' + randomUUID() + '@example.invalid';
    const password = randomBytes(32).toString('base64url') + '!aA1';
    const result = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data.user) throw Error(result.error?.message ?? 'missing user');
    const id = result.data.user.id; users.push({ id, role });
    await must(service.from('clinic_members').insert({ clinic_id: own.id, user_id: id, role, access_type: 'employee', permissions: [role === 'staff' ? 'operations.manage' : 'provider.assigned'] }));
    if (role === 'provider') await must(service.from('doctor_assignments').insert({ clinic_id: own.id, user_id: id, doctor_id: own.doctors[0], active: true }));
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    clients.push(client);
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw Error(login.error.message);
    const ownRows = await must(client.from('appointments').select('id').eq('clinic_id', own.id));
    check(role + ' authorized appointments', ownRows.length === (role === 'staff' ? 2 : 1) && ownRows.some(r => r.id === own.appointments[0]));
    const foreignRows = await must(client.from('appointments').select('id').eq('clinic_id', foreign.id));
    check(role + ' foreign brand invisible', foreignRows.length === 0);
    const configure = await client.from('doctors').update({ name: 'G302禁止修改' }).eq('id', own.doctors[0]).select('id');
    check(role + ' cannot configure providers', Boolean(configure.error) || configure.data.length === 0);
    check(role + ' provider configuration unchanged', (await must(service.from('doctors').select('name').eq('id', own.doctors[0]).single())).name === 'G302合成人員0');
    if (role === 'provider') {
      const update = await client.from('appointments').update({ status: 'done' }).eq('id', own.appointments[0]).select('id');
      check('assigned provider can mark done', !update.error && update.data.length === 1);
      const other = await client.from('appointments').update({ status: 'done' }).eq('id', own.appointments[1]).select('id');
      check('unassigned appointment cannot be changed', Boolean(other.error) || other.data.length === 0);
      const moved = await client.from('appointments').update({ start_at: new Date(Date.now() + 8 * 86400000).toISOString(), end_at: new Date(Date.now() + 8 * 86400000 + 1800000).toISOString(), status: 'done' }).eq('id', own.appointments[0]).select('id');
      check('provider cannot change appointment time along with allowed status', Boolean(moved.error) || moved.data.length === 0);
    }
  }
  const systemEmail = 'qa-g302-system-employee-' + randomUUID() + '@example.invalid';
  const systemPassword = randomBytes(32).toString('base64url') + '!aA1';
  const systemCreated = await service.auth.admin.createUser({ email: systemEmail, password: systemPassword, email_confirm: true });
  if (systemCreated.error || !systemCreated.data.user) throw Error(systemCreated.error?.message ?? 'missing system employee');
  const systemUserId = systemCreated.data.user.id;
  users.push({ id: systemUserId, role: 'system-employee' });
  await must(service.from('platform_admins').insert({ user_id: systemUserId, role: 'admin', access_type: 'employee', permissions: ['platform.overview'], active: true }));
  const systemClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  clients.push(systemClient);
  const systemLogin = await systemClient.auth.signInWithPassword({ email: systemEmail, password: systemPassword });
  if (systemLogin.error) throw Error(systemLogin.error.message);
  check('system employee has no brand membership', (await must(service.from('clinic_members').select('clinic_id').eq('user_id', systemUserId))).length === 0);
  check('system employee cannot read brand patients', (await must(systemClient.from('patients').select('id').eq('clinic_id', own.id))).length === 0);
  const platformDirect = await systemClient.from('platform_admins').select('user_id').eq('user_id', systemUserId);
  check('system employee platform membership is server-only', Boolean(platformDirect.error) || (platformDirect.data ?? []).length === 0);
} catch (error) { failure = error.message; process.exitCode = 1; }
finally {
  for (const client of clients) await client.auth.signOut().catch(() => {});
  for (const f of fixtures) {
    try {
      const found = await must(service.from('clinics').select('slug').eq('id', f.id).maybeSingle());
      if (!found) continue;
      assert.equal(found.slug, f.slug);
      for (const table of ['appointment_status_events', 'appointment_notification_logs', 'reminder_logs', 'crm_interactions', 'appointments', 'doctor_assignments', 'doctors', 'patients', 'clinic_members', 'attendance_settings', 'clinic_line_channels', 'brand_entitlements', 'clinic_activation_metrics', 'clinic_settings']) await must(service.from(table).delete().eq('clinic_id', f.id));
      await must(service.from('clinics').delete().eq('id', f.id));
      assert.equal((await must(service.from('clinics').select('id').eq('id', f.id))).length, 0);
    } catch (error) { cleanupErrors.push({ clinic: f.id, message: error.message }); }
  }
  for (const user of users) {
    if (user.role === 'system-employee') {
      const { error } = await service.from('platform_admins').delete().eq('user_id', user.id);
      if (error) cleanupErrors.push({ user: user.id, message: error.message });
    }
    const result = await service.auth.admin.deleteUser(user.id);
    if (result.error) cleanupErrors.push({ user: user.id, message: result.error.message });
  }
  if (cleanupErrors.length) process.exitCode = 1;
  writeFileSync('docs/g3-02-isolated-role-results.json', JSON.stringify({ at: new Date().toISOString(), checks, failure, cleanupErrors, fixtureIds: fixtures.map(f => f.id), userIds: users.map(u => u.id) }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, failure, cleanupErrors }));
}
