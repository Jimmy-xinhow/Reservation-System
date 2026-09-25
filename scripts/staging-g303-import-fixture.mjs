// One isolated staging brand for historical CSV import error output checks.
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2];
const slug = 'qa-g303-import-errors-20260923';
const name = 'G303 CSV 歷史錯誤驗收';
const ownerId = '6ec120c5-f325-4d12-8212-274b1be8c1a7';
const ownerEmail = 'service@xinhow.com.tw';
const canary = 'duplicate key Authorization=Bearer G303_IMPORT_SYNTHETIC_SECRET_DO_NOT_RENDER';
if (!['setup', 'inspect', 'cleanup'].includes(mode)) throw new Error('Usage: setup|inspect|cleanup');
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Pinned staging only');
}
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function must(label, query) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function exactClinic() {
  const clinic = await must('clinic', service.from('clinics').select('id,name,slug').eq('slug', slug).maybeSingle());
  if (clinic && clinic.name !== name) throw new Error('Brand name mismatch');
  return clinic;
}
const existing = await exactClinic();
if (mode === 'setup') {
  if (existing) throw new Error('Fixture brand already exists');
  const owner = await service.auth.admin.getUserById(ownerId);
  if (owner.error || owner.data.user?.email !== ownerEmail) throw new Error('Existing manager identity mismatch');
  const clinic = await must('create brand', service.from('clinics').insert({ name, slug, active: true }).select('id').single());
  await must('create manager membership', service.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: ownerId, role: 'admin', access_type: 'brand_admin', permissions: [],
  }));
  const job = await must('create historical import error', service.from('data_import_jobs').insert({
    clinic_id: clinic.id, entity: 'patients', idempotency_key: 'g303_import_existing_job',
    status: 'completed', total_rows: 1, imported_rows: 0, failed_rows: 1,
    error_summary: [{ row: 1, reason: canary }], created_by: ownerId,
  }).select('id').single());
  console.log(JSON.stringify({ created: true, slug, clinicId: clinic.id, jobId: job.id }));
} else if (mode === 'inspect') {
  if (!existing) { console.log(JSON.stringify({ slug, exists: false })); process.exit(0); }
  const jobs = await must('jobs', service.from('data_import_jobs').select('id,error_summary').eq('clinic_id', existing.id));
  console.log(JSON.stringify({ slug, clinicId: existing.id, jobCount: jobs.length,
    canaryPersisted: jobs.length === 1 && jobs[0].error_summary?.[0]?.reason === canary,
    safeReasonPersisted: jobs.length === 1 && jobs[0].error_summary?.[0]?.reason === 'import row failed' }));
} else {
  if (!existing) { console.log(JSON.stringify({ slug, exists: false })); process.exit(0); }
  const members = await must('members', service.from('clinic_members').select('user_id').eq('clinic_id', existing.id));
  if (members.some(member => member.user_id !== ownerId)) throw new Error('Unexpected brand member; refusing cleanup');
  for (const table of [
    'data_import_jobs', 'funnel_events', 'admin_product_events', 'clinic_members',
    'clinic_line_channels', 'brand_entitlements', 'attendance_settings', 'clinic_settings',
    'clinic_activation_metrics',
  ]) await must(`delete ${table}`, service.from(table).delete().eq('clinic_id', existing.id));
  await must('delete brand', service.from('clinics').delete().eq('id', existing.id));
  if (await exactClinic()) throw new Error('Fixture brand remains');
  console.log(JSON.stringify({ slug, exists: false, cleaned: true }));
}
