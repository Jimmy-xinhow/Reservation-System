import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "./supabase-server";
import { CLINIC_ID } from "./supabase";

export type Role = "admin" | "staff";

export interface MemberContext {
  user: User;
  supabase: SupabaseClient;
  role: Role;
}

/**
 * 後台守門:確認已登入且屬於本診所。
 * 回傳 authenticated client(走 RLS,只能存取自己診所)、user 與角色。
 */
export async function requireMember(): Promise<MemberContext> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("未登入");

  const { data: member } = await supabase
    .from("clinic_members")
    .select("clinic_id, role")
    .eq("clinic_id", CLINIC_ID)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) throw new Error("此帳號無本診所權限");

  const role: Role = member.role === "admin" ? "admin" : "staff";
  return { user, supabase, role };
}

/**
 * 需要管理員權限的守門。非管理員一律導回今日約診頁(頁面與 server action 都適用)。
 * 這是真正的權限強制點——UI 隱藏只是輔助。
 */
export async function requireAdmin(): Promise<MemberContext> {
  const ctx = await requireMember();
  if (ctx.role !== "admin") redirect("/admin");
  return ctx;
}
