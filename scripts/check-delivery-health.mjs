import { pathToFileURL } from 'node:url';

// Count-only reads: never export customer identities, message bodies or provider errors.
export const deliveryChecks = [
  ['appointment_notification_logs', 'status', ['sending', 'failed'], 'updated_at'],
  ['registration_notification_logs', 'status', ['sending', 'failed'], 'updated_at'],
  ['reminder_logs', 'result', ['sending', 'failed'], 'sent_at'],
  ['crm_delivery_logs', 'status', ['pending', 'failed'], 'attempted_at'],
  ['membership_notification_logs', 'status', ['claimed', 'failed'], 'created_at'],
  ['appointment_waitlist_notification_logs', 'status', ['pending', 'claimed', 'failed'], 'updated_at'],
  ['scheduled_followups', 'status', ['processing', 'failed'], 'updated_at'],
  ['scheduled_followups', 'status', ['pending'], 'scheduled_for'],
];

export async function checkDeliveryHealth(db, clinicIds, maxAgeMinutes, now = Date.now()) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Array.isArray(clinicIds) || !clinicIds.length || clinicIds.length > 100 ||
      clinicIds.some(id => typeof id !== 'string' || !uuid.test(id)) ||
      new Set(clinicIds.map(id => id.toLowerCase())).size !== clinicIds.length ||
      !Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0 || !Number.isFinite(now)) {
    return { ok: false, status: 'invalid_scope' };
  }
  const cutoffDate = new Date(now - maxAgeMinutes * 60000);
  if (!Number.isFinite(cutoffDate.getTime())) return { ok: false, status: 'invalid_scope' };
  const cutoff = cutoffDate.toISOString();
  const checks = await Promise.all(deliveryChecks.map(async ([table, column, states, time]) => {
    try {
      let query = db.from(table).select('id', { count: 'exact', head: true })
        .in('clinic_id', clinicIds).in(column, states)
        .or(`${time}.lte.${cutoff},${time}.is.null`);
      if (table === 'scheduled_followups') query = query.in('channel', ['line', 'email']);
      const { count, error } = await query;
      if (error || !Number.isSafeInteger(count) || count < 0) throw Error();
      return { table, states, count };
    } catch { return { table, states, count: null, error: 'query_failed' }; }
  }));
  const incomplete = checks.some(check => check.count === null);
  const outstanding = checks.reduce((total, check) => total + (check.count ?? 0), 0);
  return { ok: !incomplete && outstanding === 0, status: incomplete ? 'query_failed' : outstanding ? 'attention_required' : 'healthy',
    checked_at: new Date(now).toISOString(), max_age_minutes: maxAgeMinutes, clinics: clinicIds.length, outstanding, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || !args[0].startsWith('--clinic-ids=') || !args[1].startsWith('--max-age-minutes=')) throw Error();
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error();
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) } });
    const result = await checkDeliveryHealth(db, args[0].slice('--clinic-ids='.length).split(','), Number(args[1].slice('--max-age-minutes='.length)));
    console.log(JSON.stringify({ event: 'delivery_health', ...result }));
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ event: 'delivery_health', ok: false, status: 'invalid_input' }));
    process.exitCode = 1;
  }
}
