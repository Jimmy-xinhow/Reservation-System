import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !serviceKey || !anonKey
  || new URL(url).host !== 'ongjsegewpnbkqugrpom.supabase.co') {
  throw new Error('Staging Auth probe guard failed');
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `qa-g303-auth-probe-${Date.now()}-${randomBytes(4).toString('hex')}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
let userId;
let cleanup = 'not-created';
let result;
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    result = { phase: 'create', status: created.error?.status ?? null, code: created.error?.code ?? null };
  } else {
    userId = created.data.user.id;
    const signedIn = await client.auth.signInWithPassword({ email, password });
    result = { phase: 'sign-in', ok: !signedIn.error && !!signedIn.data.user,
      status: signedIn.error?.status ?? null, code: signedIn.error?.code ?? null };
    if (!signedIn.error) await client.auth.signOut();
  }
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) cleanup = `failed:${deleted.error.status ?? 'unknown'}`;
    else {
      const checked = await admin.auth.admin.getUserById(userId);
      cleanup = checked.error || !checked.data.user ? 'deleted-and-confirmed' : 'failed:still-present';
    }
  }
}
console.log(JSON.stringify({ ...result, cleanup }));
if (cleanup.startsWith('failed:')) process.exitCode = 1;
