import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !serviceKey || !anonKey
  || new URL(url).host !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Staging payment-column audit guard failed');
}
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const member = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `qa-payment-access-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
const created = { clinics: [] };
const result = {};

async function must(label, operation) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.code ?? 'unknown'}`);
  return data;
}

async function cleanup() {
  const errors = [];
  for (const clinicId of created.clinics) {
    for (const table of [
      'payment_status_events', 'payment_transactions', 'payment_webhook_events', 'payment_orders',
      'appointment_status_events', 'appointment_notification_logs', 'reminder_logs',
      'appointments', 'doctors', 'patients', 'clinic_members', 'attendance_settings',
      'clinic_line_channels', 'brand_entitlements', 'clinic_activation_metrics',
      'clinic_settings', 'clinics',
    ]) {
      const { error } = await service.from(table).delete().eq(table === 'clinics' ? 'id' : 'clinic_id', clinicId);
      if (error) errors.push(`${table}:${error.code ?? 'unknown'}`);
    }
  }
  if (created.user) {
    const { error } = await service.auth.admin.deleteUser(created.user);
    if (error) errors.push(`Auth:${error.status ?? 'unknown'}`);
  }
  if (errors.length) throw new Error(`Cleanup failed: ${errors.join(',')}`);
  for (const clinicId of created.clinics) {
    const { count, error } = await service.from('clinics').select('id', { count: 'exact', head: true }).eq('id', clinicId);
    if (error || count !== 0) throw new Error('QA brand remains');
  }
  if (created.user) {
    const { data, error } = await service.auth.admin.getUserById(created.user);
    if (!error || data?.user) throw new Error('QA Auth user remains');
  }
}

let workError;
try {
  const user = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error('Create isolated Auth user failed');
  created.user = user.data.user.id;
  const clinic = await must('clinic', service.from('clinics').insert({
    name: `QA Payment Access ${suffix}`, slug: `qa-payment-access-${suffix}`, active: true,
  }).select('id').single());
  created.clinics.push(clinic.id);
  const otherClinic = await must('other clinic', service.from('clinics').insert({
    name: `QA Payment Other ${suffix}`, slug: `qa-payment-other-${suffix}`, active: true,
  }).select('id').single());
  created.clinics.push(otherClinic.id);
  await must('brand member', service.from('clinic_members').insert({
    clinic_id: clinic.id, user_id: created.user, role: 'admin', access_type: 'brand_admin',
    permissions: ['brand.manage', 'operations.manage'],
  }));
  for (const [index, clinicId] of [clinic.id, otherClinic.id].entries()) {
    const doctor = await must('doctor', service.from('doctors').insert({
      clinic_id: clinicId, name: `QA Payment Provider ${index}`, active: true,
    }).select('id').single());
    const patient = await must('patient', service.from('patients').insert({
      clinic_id: clinicId, name: `QA Payment Customer ${index}`, phone: `09000009${index}0`,
    }).select('id').single());
    const start = new Date(Date.now() + 86400000 * (index + 2));
    const appointment = await must('appointment', service.from('appointments').insert({
      clinic_id: clinicId, doctor_id: doctor.id, patient_id: patient.id,
      start_at: start.toISOString(), end_at: new Date(start.getTime() + 1800000).toISOString(),
    }).select('id').single());
    const order = await must('payment order', service.from('payment_orders').insert({
      clinic_id: clinicId, appointment_id: appointment.id, provider: 'ecpay',
      merchant_order_no: `qa-payment-${suffix}-${index}`, amount: 100,
      provider_payload: { marker: 'synthetic-only' },
    }).select('id').single());
    await must('payment transaction', service.from('payment_transactions').insert({
      clinic_id: clinicId, payment_order_id: order.id, event_key: `qa-payment-${suffix}-${index}`,
      status: 'received', payload: { marker: 'synthetic-only' },
    }));
    await must('payment webhook', service.from('payment_webhook_events').insert({
      clinic_id: clinicId, provider: 'ecpay', event_key: `qa-payment-${suffix}-${index}`,
      payload: { marker: 'synthetic-only' },
    }));
  }
  const signIn = await member.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) throw new Error('Isolated brand login failed');

  const summary = await must('same-brand order summary', member.from('payment_orders')
    .select('id,clinic_id,status,amount,created_at').eq('clinic_id', clinic.id));
  const crossBrandSummary = await must('other-brand order summary', member.from('payment_orders')
    .select('id,clinic_id,status,amount,created_at').eq('clinic_id', otherClinic.id));
  result.sameTenantSummaryRows = summary.length;
  result.crossTenantSummaryRows = crossBrandSummary.length;
  if (summary.length !== 1 || crossBrandSummary.length !== 0) throw new Error('Payment order tenant projection mismatch');

  for (const [name, table, fields] of [
    ['safeOrderSummary', 'payment_orders', 'id,clinic_id,status,amount,created_at'],
    ['rawOrderPayload', 'payment_orders', 'provider_payload'],
    ['rawTransactionPayload', 'payment_transactions', 'payload'],
    ['rawWebhookPayload', 'payment_webhook_events', 'payload'],
  ]) {
    const { error } = await member.from(table).select(fields).eq('clinic_id', clinic.id).limit(1);
    result[name] = { allowed: !error, errorCode: error?.code ?? null };
  }
  for (const [name, table, fields] of [
    ['serviceOrderPayload', 'payment_orders', 'provider_payload'],
    ['serviceTransactionPayload', 'payment_transactions', 'payload'],
    ['serviceWebhookPayload', 'payment_webhook_events', 'payload'],
  ]) {
    const { error } = await service.from(table).select(fields).eq('clinic_id', clinic.id).limit(1);
    result[name] = { allowed: !error, errorCode: error?.code ?? null };
  }
} catch (error) {
  workError = error;
} finally {
  try { await member.auth.signOut(); } catch { /* cleanup is independent */ }
  try { await cleanup(); result.fixtureResidual = 0; } catch (error) {
    workError = workError ? new AggregateError([workError, error], 'Audit and cleanup failed') : error;
  }
}
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), environment: 'staging', ...result }, null, 2));
if (workError) throw workError;
