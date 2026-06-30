"use client";

import { createBrowserClient } from "@supabase/ssr";

/** 後台登入頁用的瀏覽器端 client(anon key,session 寫入 cookie 供 SSR 使用)。 */
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
