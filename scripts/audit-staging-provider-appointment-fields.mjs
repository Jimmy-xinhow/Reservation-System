import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !serviceKey || !anonKey
  || new URL(url).host !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Staging provider-field audit guard failed');
}
const mode = process.env.PROVIDER_FIELD_AUDIT_MODE;
if (!['probe', 'verify', 'orphan'].includes(mode)) throw new Error('PROVIDER_FIELD_AUDIT_MODE must be probe, verify, or orphan');

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const provider = createClient(url, anonKey, options);
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const slug = `qa-provider-fields-${suffix}`;
const created = { clinicId: null, userId: null };
const fixtureTables = [
  'appointment_status_events', 'appointment_notification_logs', 'reminder_logs',
  'admin_product_events', 'crm_interactions', 'appointments', 'doctor_assignments',
  'doctors', 'patients', 'clinic_members', 'attendance_settings', 'clinic_line_channels',
  'brand_entitlements', 'clinic_activation_metrics', 'clinic_settings', 'clinics',
];

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
    for (const table of fixtureTables) {
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
    for (const table of fixtureTables) {
      const { count, error } = await service.from(table).select('*', { count: 'exact', head: true })
        .eq(table === 'clinics' ? 'id' : 'clinic_id', created.clinicId);
      if (error) throw new Error(`QA ${table} cleanup check failed: ${error.code ?? 'unknown'}`);
      if (count !== 0) throw new Error(`QA ${table} remains`);
    }
  }
  if (created.userId) {
    const { data, error } = await service.auth.admin.getUserById(created.userId);
    if (!error || data?.user) throw new Error('QA Auth user remains');
  }
}

let result;
let workError;
try {
  const clinic = await must('clinic', service.from('clinics').insert({
    name: `QA provider fields ${suffix}`, slug, active: true,
  }).select('id').single());
  created.clinicId = clinic.id;
  const patient = await must('patient', service.from('patients').insert({
    clinic_id: clinic.id, name: `QA provider fields patient ${suffix}`, phone: '0900000877',
  }).select('id').single());
  const doctor = await must('doctor', service.from('doctors').insert({
    clinic_id: clinic.id, name: `QA provider ${suffix}`, active: true,
  }).select('id').single());
  const start = new Date(Date.now() + 7 * 86400000);
  const appointment = await must('appointment', service.from('appointments').insert({
    clinic_id: clinic.id, doctor_id: doctor.id, patient_id: patient.id,
    start_at: start.toISOString(), end_at: new Date(start.getTime() + 1800000).toISOString(),
    status: 'booked',
  }).select('id').single());
  const email = `qa-provider-fields-${suffix}@example.invalid`;
  const password = `${randomBytes(20).toString('base64url')}Aa1!`;
  const { data: authData, error: authError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError || !authData.user) throw new Error('Create QA Auth user failed');
  created.userId = authData.user.id;
  await must('membership', service.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: authData.user.id, role: 'provider',
    access_type: 'employee', permissions: ['provider.assigned'],
  }));
  await must('assignment', service.from('doctor_assignments').insert({
    clinic_id: clinic.id, user_id: authData.user.id, doctor_id: doctor.id, active: true,
  }));
  await must('sign in', provider.auth.signInWithPassword({ email, password }));
  if (mode === 'orphan') {
    await must('remove QA membership but retain assignment', service.from('clinic_members')
      .delete().eq('clinic_id', clinic.id).eq('user_id', authData.user.id));
  }

  const updateRequest = provider.from('appointments').update({
    status: 'done', booking_answers: { qa_provider_field_probe: true },
  }).eq('id', appointment.id).eq('clinic_id', clinic.id);
  const unauthorized = mode === 'orphan'
    ? await updateRequest
    : await updateRequest.select('id,status,booking_answers');
  const stored = await must('read appointment after attempt', service.from('appointments')
    .select('status,booking_answers').eq('id', appointment.id).single());
  const changedExtraField = stored.booking_answers?.qa_provider_field_probe === true;
  if (mode === 'verify') {
    if (unauthorized.error?.code !== 'P0001' || changedExtraField || stored.status !== 'booked') {
      throw new Error('Provider status-only guard did not reject the extra field');
    }
    const allowed = await must('status-only provider update', provider.from('appointments')
      .update({ status: 'done' }).eq('id', appointment.id).eq('clinic_id', clinic.id).select('id,status'));
    if (allowed.length !== 1 || allowed[0].status !== 'done') throw new Error('Allowed provider status update failed');
  }
  if (mode === 'orphan' && (changedExtraField || stored.status !== 'booked')) {
    throw new Error('Removed clinic member changed an appointment through a stale assignment');
  }
  result = {
    mode,
    unauthorizedUpdateAccepted: !unauthorized.error
      && (mode === 'orphan' ? changedExtraField : (unauthorized.data?.length ?? 0) === 1),
    unauthorizedErrorCode: unauthorized.error?.code ?? null,
    changedExtraField,
    statusAfterAttempt: stored.status,
    statusOnlyUpdateAllowed: mode === 'verify' ? true : null,
  };
} catch (error) {
  workError = error;
} finally {
  try { await provider.auth.signOut(); } catch { /* Exact cleanup follows. */ }
  try { await cleanup(); } catch (error) { workError = workError ?? error; }
}
if (workError) throw workError;
console.log(JSON.stringify({ ...result, cleanup: 'zero residual' }));
