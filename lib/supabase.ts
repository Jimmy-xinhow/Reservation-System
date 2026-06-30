import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * anon client(公開金鑰)。
 * 僅用於後台 Supabase Auth 流程;anon 無任何資料表 policy,讀不到病患資料。
 * 病患端「絕不」使用此 client 直接讀寫 DB。
 */
export function createAnonClient(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let _admin: SupabaseClient | null = null;

/**
 * service-role client(繞過 RLS)。**只能在 server 端使用。**
 * service key 來自 SUPABASE_SERVICE_ROLE_KEY,絕不可出現在 client 或 NEXT_PUBLIC_*。
 */
export function createServiceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("service-role client 只能在 server 端建立");
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!_admin) {
    _admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

/** 本版鎖定單一診所。 */
export const CLINIC_ID = process.env.NEXT_PUBLIC_CLINIC_ID ?? "";
