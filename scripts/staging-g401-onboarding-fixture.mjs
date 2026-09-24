// Inspect or clean the one-off G4-01 UI onboarding fixture. Never target a shared brand.
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2];
const slug = 'qa-g401-20260923-4e6b';
const name = 'G401 隔離開通驗收';
const staffEmail = 'qa-g401-20260923-4e6b@example.invalid';
const staffUserId = 'f82817aa-3c5f-4b25-9b51-6131da85998d';
if (!['inspect', 'cleanup'].includes(mode)) throw new Error('Usage: inspect|cleanup');
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Pinned staging only');
}
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function removeExactStaff() {
  const lookup = await service.auth.admin.getUserById(staffUserId);
  if (lookup.error && lookup.error.status !== 404) throw new Error(`QA Auth lookup: ${lookup.error.message}`);
  if (!lookup.data?.user) return;
  if (lookup.data.user.email !== staffEmail) throw new Error('QA Auth email mismatch; refusing cleanup');
  const removed = await service.auth.admin.deleteUser(staffUserId);
  if (removed.error) throw new Error(`delete QA Auth user: ${removed.error.message}`);
  console.log('Exact G4-01 Auth staff cleaned');
}
async function must(label, query) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
const clinic = await must('clinic', service.from('clinics').select('id,name,slug,active,created_at')
  .eq('slug', slug).maybeSingle());
if (!clinic) {
  if (mode === 'cleanup') await removeExactStaff();
  console.log(JSON.stringify({ slug, exists: false }));
  process.exit(0);
}
if (clinic.name !== name) throw new Error('Brand name mismatch; refusing to operate');
const id = clinic.id;
const tables = ['clinic_settings', 'clinic_members', 'services', 'doctors', 'schedule_templates',
  'patients', 'appointments', 'appointment_status_events', 'appointment_notification_logs'];
const counts = {};
for (const table of tables) {
  const result = await service.from(table).select('*', { count: 'exact', head: true }).eq('clinic_id', id);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  counts[table] = result.count;
}
const members = await must('members', service.from('clinic_members').select('user_id,access_type')
  .eq('clinic_id', id));
const userEmails = [];
for (const member of members) {
  const result = await service.auth.admin.getUserById(member.user_id);
  if (result.error || !result.data.user) throw new Error('Member Auth lookup failed');
  userEmails.push({ id: member.user_id, email: result.data.user.email, accessType: member.access_type });
}
const settings = await must('settings', service.from('clinic_settings')
  .select('booking_mode,public_booking_enabled,line_channel_enabled,email_enabled,min_lead_minutes,max_advance_days')
  .eq('clinic_id', id).maybeSingle());
const [services, schedules, appointments, patients] = await Promise.all([
  must('services', service.from('services').select('id,name,booking_target,active').eq('clinic_id', id)),
  must('schedules', service.from('schedule_templates').select('id,service_id,doctor_id,weekday,start_time,end_time,capacity,active').eq('clinic_id', id)),
  must('appointments', service.from('appointments').select('id,patient_id,service_id,doctor_id,status,start_at,source,deposit_status').eq('clinic_id', id)),
  must('patients', service.from('patients').select('id,name,phone,birthday').eq('clinic_id', id)),
]);
console.log(JSON.stringify({ clinic, settings, counts, members: userEmails, services, schedules,
  appointments: appointments.map(({ patient_id, ...row }) => ({ ...row, qaPatient: patients.some(patient =>
    patient.id === patient_id && patient.name === 'G401 合成顧客' && patient.phone === '0900004401' && patient.birthday === '1990-01-01'),
  })),
}));

if (mode === 'cleanup') {
  const qaUsers = userEmails.filter(user => user.email === staffEmail);
  if (userEmails.some(user => user.email?.startsWith('qa-g401-') && user.email !== staffEmail) || qaUsers.length > 1) {
    throw new Error('Unexpected QA member; refusing cleanup');
  }
  const failures = [];
  const remove = async table => {
    const result = await service.from(table).delete().eq('clinic_id', id);
    if (result.error) failures.push(`${table}: ${result.error.message}`);
  };
  for (const table of [
    'funnel_events', 'admin_product_events', 'appointment_waitlist_notification_logs', 'appointment_waitlist_events',
    'appointment_notification_logs', 'appointment_status_events', 'reminder_logs',
    'crm_interactions', 'payment_status_events', 'payment_transactions', 'payment_orders',
    'appointment_waitlist_entries', 'appointments',
    'doctor_assignments', 'schedule_exceptions', 'schedule_templates',
    'service_resource_assignments', 'service_resources', 'service_addons',
    'services', 'doctors', 'patient_records', 'customer_submission_requests', 'patients', 'clinic_members',
    'attendance_settings', 'clinic_line_channels', 'brand_entitlements', 'clinic_settings',
  ]) await remove(table);
  await remove('clinic_activation_metrics');
  const clinicDelete = await service.from('clinics').delete().eq('id', id);
  if (clinicDelete.error) failures.push(`clinics: ${clinicDelete.error.message}`);
  if (failures.length) throw new Error(failures.join('; '));
  await removeExactStaff();
  const verify = await service.from('clinics').select('id').eq('id', id);
  if (verify.error || verify.data?.length) throw new Error('QA brand remains');
  console.log('Exact G4-01 fixture cleaned');
}
