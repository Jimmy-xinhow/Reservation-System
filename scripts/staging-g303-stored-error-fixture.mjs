// One isolated staging brand for verifying how old raw delivery errors render.
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2];
const slug = 'qa-g303-stored-errors-20260923';
const name = 'G303 歷史錯誤顯示驗收';
const ownerId = '6ec120c5-f325-4d12-8212-274b1be8c1a7';
const ownerEmail = 'service@xinhow.com.tw';
const canary = 'fetch failed Authorization=Bearer G303_SYNTHETIC_SECRET_DO_NOT_RENDER';
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
  const id = clinic.id;
  await must('create manager membership', service.from('clinic_members').insert({
    clinic_id: id, user_id: ownerId, role: 'admin', access_type: 'brand_admin', permissions: [],
  }));
  await must('enable CRM for fixture', service.from('clinic_settings').update({
    crm_automation_enabled: true, line_channel_enabled: false, email_enabled: false,
  }).eq('clinic_id', id));
  const patient = await must('create patient', service.from('patients').insert({
    clinic_id: id, name: 'G303 合成顧客', phone: '0900004303', birthday: '1990-01-03',
  }).select('id').single());
  const automation = await must('create inactive automation', service.from('crm_automations').insert({
    clinic_id: id, name: 'G303 顯示驗收', trigger_type: 'birthday', channel: 'line', body: '合成測試', active: false,
  }).select('id').single());
  await must('create historical delivery error', service.from('crm_delivery_logs').insert({
    clinic_id: id, automation_id: automation.id, patient_id: patient.id,
    trigger_key: 'g303:synthetic', channel: 'line', status: 'failed', error: canary, attempt_count: 1,
  }));
  await must('create historical followup error', service.from('scheduled_followups').insert({
    clinic_id: id, patient_id: patient.id, channel: 'line', purpose: 'service',
    subject: 'G303 合成回訪', body: '合成測試', scheduled_for: new Date(Date.now() - 60_000).toISOString(),
    status: 'failed', attempt_count: 1, last_error: canary,
  }));
  console.log(JSON.stringify({ created: true, slug, clinicId: id, patientId: patient.id }));
} else if (mode === 'inspect') {
  if (!existing) { console.log(JSON.stringify({ slug, exists: false })); process.exit(0); }
  const id = existing.id;
  const [delivery, followup, patient] = await Promise.all([
    must('delivery', service.from('crm_delivery_logs').select('id,error').eq('clinic_id', id)),
    must('followup', service.from('scheduled_followups').select('id,last_error').eq('clinic_id', id)),
    must('patient', service.from('patients').select('id').eq('clinic_id', id).single()),
  ]);
  console.log(JSON.stringify({ slug, clinicId: id, patientId: patient.id,
    deliveryRows: delivery.length, followupRows: followup.length,
    canaryPersisted: delivery.length === 1 && followup.length === 1 &&
      delivery[0].error === canary && followup[0].last_error === canary }));
} else {
  if (!existing) { console.log(JSON.stringify({ slug, exists: false })); process.exit(0); }
  const id = existing.id;
  const members = await must('members', service.from('clinic_members').select('user_id').eq('clinic_id', id));
  if (members.some(member => member.user_id !== ownerId)) throw new Error('Unexpected brand member; refusing cleanup');
  for (const table of [
    'crm_delivery_logs', 'scheduled_followups', 'crm_automations', 'crm_interactions',
    'funnel_events', 'admin_product_events', 'patient_records', 'patients', 'clinic_members',
    'clinic_line_channels', 'brand_entitlements', 'attendance_settings', 'clinic_settings',
    'clinic_activation_metrics',
  ]) await must(`delete ${table}`, service.from(table).delete().eq('clinic_id', id));
  await must('delete brand', service.from('clinics').delete().eq('id', id));
  if (await exactClinic()) throw new Error('Fixture brand remains');
  console.log(JSON.stringify({ slug, exists: false, cleaned: true }));
}
