import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging'
  || !url || !serviceKey || !anonKey
  || new URL(url).host !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Staging role-permission audit guard failed');
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const slug = `qa-role-permission-${suffix}`;
const created = { clinicId: null, userId: null };

async function must(label, operation) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.code ?? error.status ?? 'unknown'}`);
  return data;
}

async function cleanup() {
  const errors = [];
  if (created.clinicId) {
    const existing = await must('verify QA clinic', service.from('clinics').select('slug').eq('id', created.clinicId).maybeSingle());
    if (existing?.slug !== slug) throw new Error('QA clinic identity mismatch during cleanup');
    for (const table of [
      'admin_product_events', 'appointments', 'doctor_assignments', 'doctors',
      'patients', 'clinic_members', 'attendance_settings', 'clinic_line_channels',
      'brand_entitlements', 'clinic_activation_metrics', 'clinic_settings', 'clinics',
    ]) {
      const { error } = await service.from(table).delete().eq(table === 'clinics' ? 'id' : 'clinic_id', created.clinicId);
      if (error) errors.push(`${table}:${error.code ?? 'unknown'}`);
    }
  }
  if (created.userId) {
    const { error } = await service.auth.admin.deleteUser(created.userId);
    if (error) errors.push(`Auth:${error.status ?? 'unknown'}`);
  }
  if (errors.length) throw new Error(`Fixture cleanup failed: ${errors.join(',')}`);
  if (created.clinicId) {
    const { count, error } = await service.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinicId);
    if (error || count !== 0) throw new Error('QA clinic remains');
  }
  if (created.userId) {
    const { data, error } = await service.auth.admin.getUserById(created.userId);
    if (!error || data?.user) throw new Error('QA Auth user remains');
  }
}

let result;
let workError;
try {
  const clinic = await must('create QA clinic', service.from('clinics')
    .insert({ name: `QA role permission ${suffix}`, slug, active: true }).select('id').single());
  created.clinicId = clinic.id;
  const patient = await must('create QA patient', service.from('patients')
    .insert({ clinic_id: clinic.id, name: `QA role permission patient ${suffix}`, phone: '0900000876' })
    .select('id').single());
  const email = `qa-role-permission-${suffix}@example.invalid`;
  const password = `${randomBytes(20).toString('base64url')}Aa1!`;
  const { data: authData, error: authError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError || !authData.user) throw new Error('Create QA Auth user failed');
  created.userId = authData.user.id;
  const mismatchedMember = await service.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: authData.user.id,
    role: 'staff', access_type: 'employee', permissions: ['provider.assigned'],
  });
  if (mismatchedMember.error?.code !== '23514') {
    throw new Error(`Mismatched membership was not rejected: ${mismatchedMember.error?.code ?? 'accepted'}`);
  }
  await must('create valid provider membership', service.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: authData.user.id,
    role: 'provider', access_type: 'employee', permissions: ['provider.assigned'],
  }));
  await must('sign in QA user', anon.auth.signInWithPassword({ email, password }));
  const restrictedRows = await must('read own-brand patients as restricted employee', anon.from('patients')
    .select('id,phone').eq('clinic_id', clinic.id));
  await must('grant operations permission in QA brand', service.from('clinic_members').update({
    role: 'staff', permissions: ['operations.manage'],
  }).eq('clinic_id', clinic.id).eq('user_id', authData.user.id));
  const operatorRows = await must('read own-brand patients as operator', anon.from('patients')
    .select('id,phone').eq('clinic_id', clinic.id));
  result = {
    mismatchedLegacyRoleRejected: true,
    providerOnlyUnassignedPatientCount: restrictedRows.length,
    operatorOwnBrandPatientCount: operatorRows.length,
  };
  if (restrictedRows.length !== 0 || operatorRows.length !== 1 || operatorRows[0].id !== patient.id) {
    throw new Error('RLS permission projection did not match expected provider and operator behavior');
  }
} catch (error) {
  workError = error;
} finally {
  try { await anon.auth.signOut(); } catch { /* exact Auth cleanup follows */ }
  try { await cleanup(); } catch (error) { workError = workError ?? error; }
}
if (workError) throw workError;
console.log(JSON.stringify({ ...result, cleanup: 'zero residual' }));
