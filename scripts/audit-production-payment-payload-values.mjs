import { createClient } from '@supabase/supabase-js';

const expectedHost = 'cmoacgcbxllfpwhiidsx.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Production read-only payment-value audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.from('payment_transactions').select('payload').order('id');
if (error || !Array.isArray(data)) throw new Error(`Read-only payment query failed (${error?.code ?? 'invalid_response'})`);
if (data.length > 1000) throw new Error('Payment population exceeds the single-page audit limit');

const legacy = data.filter(row => row.payload && typeof row.payload === 'object'
  && !Array.isArray(row.payload) && Object.keys(row.payload).length > 0 && row.payload.receipt_version !== 1);
const counts = { email: 0, taiwanMobile: 0, luhnCard: 0, authSecret: 0, lineUserId: 0, longOpaque: 0, nestedObjects: 0 };

function luhn(value) {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let index = digits.length - 1, double = false; index >= 0; index -= 1, double = !double) {
    let digit = Number(digits[index]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

function inspect(value, depth = 0) {
  if (depth > 8) throw new Error('Payment payload nesting exceeds audit limit');
  if (Array.isArray(value)) { counts.nestedObjects += 1; value.forEach(item => inspect(item, depth + 1)); return; }
  if (value && typeof value === 'object') {
    if (depth > 0) counts.nestedObjects += 1;
    Object.values(value).forEach(item => inspect(item, depth + 1));
    return;
  }
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) counts.email += 1;
  if (/(?:^|\D)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?:\D|$)/.test(text)) counts.taiwanMobile += 1;
  if (luhn(text)) counts.luhnCard += 1;
  if (/(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}\.|(?:sk|rk|pk)_[A-Za-z0-9]{20,})/i.test(text)) counts.authSecret += 1;
  if (/^U[0-9a-f]{32}$/i.test(text)) counts.lineUserId += 1;
  if (text.length > 128 && !/\s/.test(text)) counts.longOpaque += 1;
}
legacy.forEach(row => inspect(row.payload));
console.log(JSON.stringify({
  auditedAt: new Date().toISOString(), environment: 'production', supabaseHost: expectedHost,
  readOnly: true, rawValuesPrinted: false, rawKeysPrinted: false, identifiersPrinted: false,
  legacyTransactionPayloads: legacy.length, matchedValuePatterns: counts,
  limitation: 'Pattern counts only; zero matches cannot prove no PII or decide retention legality',
}, null, 2));
