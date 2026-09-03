"use client";

import { createBrowserClient } from "@supabase/ssr";

interface SupabaseBrowserOptions {
  /** 清理舊 session 時避免先消耗 URL 中的一次性回呼 token。 */
  detectSessionInUrl?: boolean;
}

/** 後台登入頁用的瀏覽器端 client(anon key,session 寫入 cookie 供 SSR 使用)。 */
export function createSupabaseBrowser(options: SupabaseBrowserOptions = {}) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { detectSessionInUrl: options.detectSessionInUrl ?? true } },
  );
}
