import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 後台用的 Supabase server client(authenticated,帶使用者 session cookie)。
 * 走 RLS,只能存取自己診所的資料。
 */
export async function createSupabaseServer(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of list) cookieStore.set({ name, value, ...options });
        } catch {
          // 在 Server Component render 階段無法寫 cookie;由 middleware 刷新 session。
        }
      },
    },
  });
}
