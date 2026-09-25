// Temporary G3-02 browser identities. Run only with explicit approval against the pinned staging project.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2];
const file = 'tmp/g302-ui-fixture.json';
assert.equal(process.env.RAILWAY_ENVIRONMENT_NAME, 'staging');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'ongjsegewpnbkqugrpom.supabase.co');
assert.equal(process.env.G302_TEMP_ROLE_APPROVED, 'yes');
assert.ok(['setup', 'cleanup'].includes(mode), 'Usage: staging-role-ui-fixture.mjs setup|cleanup');
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {persistSession: false, autoRefreshToken: false},
});
const must = async (label, query) => {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const save = manifest => {
  mkdirSync('tmp', {recursive: true});
  writeFileSync(file, JSON.stringify(manifest, null, 2));
};

async function cleanup(manifest) {
  const failures = [];
  const remove = async (table, column, id) => {
    try { await must(`delete ${table}`, service.from(table).delete().eq(column, id)); }
    catch (error) { failures.push(`${table}: ${error.message}`); }
  };
  if (manifest.clinicId) {
    const clinic = await must('confirm fixture clinic', service.from('clinics').select('slug').eq('id', manifest.clinicId).maybeSingle());
    if (clinic) {
      assert.equal(clinic.slug, manifest.slug);
      for (const table of [
        'admin_product_events', 'appointment_status_events', 'appointment_notification_logs', 'reminder_logs', 'crm_interactions',
        'appointments', 'doctor_assignments', 'doctors', 'patients', 'clinic_members',
        'attendance_settings', 'clinic_line_channels', 'brand_entitlements', 'clinic_activation_metrics', 'clinic_settings',
      ]) await remove(table, 'clinic_id', manifest.clinicId);
      await remove('clinics', 'id', manifest.clinicId);
    }
  }
  for (const user of Object.values(manifest.users ?? {})) {
    if (user.kind === 'system-employee') await remove('platform_admins', 'user_id', user.id);
    const deleted = await service.auth.admin.deleteUser(user.id);
    if (deleted.error && deleted.error.message !== 'User not found') failures.push(`auth user ${user.id}: ${deleted.error.message}`);
  }
  const [clinic, ...users] = await Promise.all([
    manifest.clinicId ? must('check fixture clinic', service.from('clinics').select('id').eq('id', manifest.clinicId)) : [],
    ...Object.values(manifest.users ?? {}).map(async user => {
      const result = await service.auth.admin.getUserById(user.id);
      return result.data?.user ?? null;
    }),
  ]);
  if (clinic.length || users.some(Boolean)) failures.push('Fixture identities remain after cleanup');
  if (failures.length) throw new Error(failures.join('; '));
  save({...manifest, cleanedAt: new Date().toISOString(), users: Object.fromEntries(Object.entries(manifest.users ?? {}).map(([kind, user]) => [kind, {id: user.id, kind}]))});
  return {clinicRemaining: clinic.length, userRemaining: users.filter(Boolean).length};
}

if (mode === 'cleanup') {
  assert.ok(existsSync(file), 'Missing exact fixture manifest');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  console.log(JSON.stringify({cleaned: await cleanup(manifest)}));
} else {
  assert.ok(!existsSync(file), 'Existing fixture manifest must be cleaned and archived before setup');
  const manifest = {createdAt: new Date().toISOString(), projectRef: 'ongjsegewpnbkqugrpom', users: {}};
  save(manifest);
  try {
    manifest.clinicId = randomUUID();
    manifest.slug = 'qa-g302-ui-' + randomUUID();
    save(manifest);
    await must('create fixture clinic', service.from('clinics').insert({id: manifest.clinicId, slug: manifest.slug, name: 'G302 UI 隔離驗收'}));
    await must('disable fixture channels', service.from('clinic_settings').update({line_channel_enabled: false, email_enabled: false, crm_automation_enabled: false}).eq('clinic_id', manifest.clinicId));
    const patient = await must('create fixture patient', service.from('patients').insert({clinic_id: manifest.clinicId, name: 'G302 UI 合成顧客', phone: '09' + String(Date.now()).slice(-8), marketing_opt_in: false}).select('id').single());
    const doctor = await must('create fixture provider', service.from('doctors').insert({clinic_id: manifest.clinicId, name: 'G302 UI 合成服務人員'}).select('id').single());
    const start = new Date(Date.now() + 7 * 86400000);
    const appointment = await must('create fixture appointment', service.from('appointments').insert({clinic_id: manifest.clinicId, patient_id: patient.id, doctor_id: doctor.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 1800000).toISOString()}).select('id').single());
    manifest.appointmentId = appointment.id;
    save(manifest);
    for (const [kind, role, permissions] of [
      ['brand-employee', 'staff', ['operations.manage']],
      ['provider', 'provider', ['provider.assigned']],
      ['system-employee', 'admin', ['platform.overview']],
    ]) {
      const email = `qa-g302-${kind}-${randomUUID()}@example.invalid`;
      const password = randomBytes(32).toString('base64url') + '!aA1';
      const created = await service.auth.admin.createUser({email, password, email_confirm: true});
      if (created.error || !created.data.user) throw new Error(`create ${kind}: ${created.error?.message ?? 'missing user'}`);
      manifest.users[kind] = {id: created.data.user.id, kind, email, password};
      save(manifest);
      if (kind === 'system-employee') await must('system employee role', service.from('platform_admins').insert({user_id: created.data.user.id, role, access_type: 'employee', permissions, active: true}));
      else await must(`${kind} role`, service.from('clinic_members').insert({clinic_id: manifest.clinicId, user_id: created.data.user.id, role, access_type: 'employee', permissions}));
      if (kind === 'provider') await must('provider assignment', service.from('doctor_assignments').insert({clinic_id: manifest.clinicId, user_id: created.data.user.id, doctor_id: doctor.id, active: true}));
    }
    console.log(JSON.stringify({clinicId: manifest.clinicId, slug: manifest.slug, roles: Object.keys(manifest.users), credentialFile: file}));
  } catch (error) {
    try { await cleanup(manifest); }
    catch (cleanupError) { throw new Error(`Fixture setup failed: ${error.message}; cleanup failed: ${cleanupError.message}`); }
    throw error;
  }
}
