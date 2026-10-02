import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Staging Rich Menu cleanup guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: clinics, error } = await db.from('clinics').select('id,slug').like('slug', 'qa-richmenu-g30324-%');
if (error) throw new Error(`Isolated brand lookup failed: ${error.code ?? 'unknown'}`);
const tables = [
  'line_richmenu_schedules', 'line_richmenu_aliases', 'line_richmenu_publication_events',
  'line_richmenu', 'line_richmenu_versions', 'line_auto_replies', 'line_messages', 'funnel_events',
  'patient_records', 'appointment_waitlist_notification_logs', 'appointment_waitlist_events',
  'appointment_waitlist_entries', 'appointment_status_events', 'appointment_notification_logs',
  'reminder_logs', 'crm_interactions', 'appointments', 'doctors', 'patients', 'clinic_members',
  'attendance_settings', 'clinic_line_channels', 'brand_entitlements', 'clinic_activation_metrics',
  'clinic_settings', 'clinics',
];
for (const clinic of clinics ?? []) {
  for (const table of tables) {
    const column = table === 'clinics' ? 'id' : 'clinic_id';
    const { error: deletionError } = await db.from(table).delete().eq(column, clinic.id);
    if (deletionError) throw new Error(`${clinic.slug} ${table}: ${deletionError.code ?? 'unknown'} ${deletionError.message}`);
  }
  const { count, error: checkError } = await db.from('clinics').select('id', { count: 'exact', head: true }).eq('id', clinic.id);
  if (checkError || count !== 0) throw new Error(`${clinic.slug} still exists`);
}
console.log(JSON.stringify({ cleanedBrands: clinics?.length ?? 0, brandResidual: 0 }));
