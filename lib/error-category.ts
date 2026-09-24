/** Only allowlisted categories may enter common error logs; never raw messages. */
export function errorCategory(message: string): string {
  if (/SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL|未設定|請設定/.test(message)) return "configuration";
  if (/violates .*constraint|duplicate key|foreign key|permission denied/i.test(message)) return "database";
  if (/fetch failed|timeout|timed out|ECONN|ENOTFOUND/i.test(message)) return "connection";
  return "internal";
}
