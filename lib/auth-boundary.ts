import type { SupabaseClient } from "@supabase/supabase-js";

export const ACCESS_UNAVAILABLE = "權限驗證服務暫時無法使用，請稍後再試。";

const rejectedSessionCodes = new Set([
  "bad_jwt", "session_not_found", "session_expired", "refresh_token_not_found",
  "refresh_token_already_used", "user_not_found", "user_banned",
]);

/** Do not attach the upstream error as cause: frameworks may log it recursively. */
export async function readAccessData<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try {
    const result = await query;
    if (result.error) throw new Error(ACCESS_UNAVAILABLE);
    return result.data;
  } catch {
    throw new Error(ACCESS_UNAVAILABLE);
  }
}

/** Invalid/missing sessions are anonymous; infrastructure failures are not. */
export async function readVerifiedUser(client: SupabaseClient) {
  try {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (!data.user && (error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403
        || (error.status === 400 && rejectedSessionCodes.has(error.code ?? "")))) return null;
      throw new Error(ACCESS_UNAVAILABLE);
    }
    return data.user;
  } catch {
    throw new Error(ACCESS_UNAVAILABLE);
  }
}
