import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";

export interface AccountSummary {
  email: string;
  emailConfirmedAt: string | null;
  invitedAt: string | null;
  lastSignInAt: string | null;
}

/** Call only after authorizing and reading the page's scoped membership IDs. */
export async function readAdminAccountSummaries(service: SupabaseClient, userIds: readonly string[]): Promise<Map<string, AccountSummary>> {
  const ids = [...new Set(userIds)];
  const summaries = new Map<string, AccountSummary>();
  for (let offset = 0; offset < ids.length; offset += 8) {
    await adminQuery(Promise.all(ids.slice(offset, offset + 8).map(async (id) => {
      const { data, error } = await service.auth.admin.getUserById(id);
      if (error || !data?.user || data.user.id !== id) {
        throw new Error(adminErrorMessage(error ?? "成員帳號載入失敗"));
      }
      summaries.set(id, {
        email: data.user.email ?? "未設定 Email",
        emailConfirmedAt: data.user.email_confirmed_at ?? null,
        invitedAt: data.user.invited_at ?? null,
        lastSignInAt: data.user.last_sign_in_at ?? null,
      });
    })));
  }
  return summaries;
}
