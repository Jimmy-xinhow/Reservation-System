import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServer } from "./supabase-server";
import { CLINIC_ID } from "./supabase";

/**
 * 後台守門:確認已登入且屬於本診所。
 * 回傳 authenticated client(走 RLS,只能存取自己診所)與 user。
 */
export async function requireMember(): Promise<{ user: User; supabase: SupabaseClient }> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("未登入");

  const { data: member } = await supabase
    .from("clinic_members")
    .select("clinic_id")
    .eq("clinic_id", CLINIC_ID)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) throw new Error("此帳號無本診所權限");

  return { user, supabase };
}
