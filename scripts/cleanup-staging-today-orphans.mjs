import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Staging orphan cleanup guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: clinics, error } = await db.from('clinics').select('id,slug,name').like('slug', 'qa-today-g30324-%');
if (error || !Array.isArray(clinics)) throw new Error(`Find isolated fixtures failed: ${error?.code ?? 'invalid_response'}`);
if (clinics.length > 1) throw new Error('More than one isolated fixture found; inspect before cleanup');
for (const clinic of clinics) {
  if (!clinic.name.startsWith('QA Today G30324 ')) throw new Error('Fixture name guard failed');
  for (const table of [
    'appointment_waitlist_notification_logs', 'appointment_waitlist_events', 'appointment_waitlist_entries',
    'appointment_status_events', 'appointment_notification_logs', 'reminder_logs', 'crm_interactions',
    'appointments', 'doctors', 'patients', 'clinic_members', 'attendance_settings',
    'clinic_line_channels', 'brand_entitlements', 'clinic_activation_metrics', 'clinic_settings',
    'clinics',
  ]) {
    const { error: deleteError } = await db.from(table).delete().eq(table === 'clinics' ? 'id' : 'clinic_id', clinic.id);
    if (deleteError) throw new Error(`Cleanup ${table} failed: ${deleteError.code}`);
  }
  const { count, error: checkError } = await db.from('clinics').select('id', { count: 'exact', head: true }).eq('id', clinic.id);
  if (checkError || count !== 0) throw new Error('Isolated fixture residual remains');
}
console.log(JSON.stringify({ isolatedBrandsFound: clinics.length, residualBrands: 0 }));
