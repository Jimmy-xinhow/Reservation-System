"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";
import { requireSystemAdmin } from "@/lib/platform";
import { normalizeSystemPermissions, type PlatformAccessType } from "@/lib/platform-roles";
import { authInviteRedirectUrl } from "@/lib/auth-invite";

function value(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

export async function upsertPlatformAdminAction(fd: FormData): Promise<void> {
  const actor = await requireSystemAdmin();
  const email = value(fd, "email").toLowerCase();
  const password = value(fd, "password");
  const passwordConfirmation = value(fd, "password_confirmation");
  const accessType: PlatformAccessType = value(fd, "access_type") === "system_admin" ? "system_admin" : "employee";
  const selectedPermissions = normalizeSystemPermissions(fd.getAll("permissions").map((permission) => permission.toString()));
  const permissions = accessType === "system_admin" ? [] : [...new Set(["platform.overview" as const, ...selectedPermissions])];
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("請輸入有效的系統管理員 Email。");
  if (password || passwordConfirmation) {
    if (password.length < 8) throw new Error("初始密碼至少需要 8 碼。");
    if (password !== passwordConfirmation) throw new Error("兩次輸入的初始密碼不一致。");
  }

  const service = createServiceClient();
  const { data: users, error: usersError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw new Error(`查詢使用者失敗：${usersError.message}`);
  let user = users.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
  let createdAuthUserId: string | null = null;
  if (!user) {
    const { data, error } = password
      ? await service.auth.admin.createUser({ email, password, email_confirm: true })
      : await service.auth.admin.inviteUserByEmail(email, { redirectTo: authInviteRedirectUrl() });
    if (error || !data.user) {
      const operation = password ? "建立系統人員登入帳號" : "寄送系統人員邀請";
      throw new Error(`${operation}失敗：${error?.message ?? "找不到使用者"}`);
    }
    user = data.user;
    createdAuthUserId = user.id;
  } else if (password) {
    const { error } = await service.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) throw new Error(`設定系統人員登入密碼失敗：${error.message}`);
  }

  if (user.id === actor.user.id && accessType !== "system_admin") throw new Error("不可降低目前登入帳號的系統管理身分");

  const { error } = await service.from("platform_admins").upsert({ user_id: user.id, role: "admin", access_type: accessType, permissions, active: true }, { onConflict: "user_id" });
  if (error) {
    if (createdAuthUserId) await service.auth.admin.deleteUser(createdAuthUserId);
    throw new Error(`儲存系統人員權限失敗：${error.message}`);
  }
  revalidatePath("/admin/platform/admins");
  revalidatePath("/admin/platform");
}

export async function setPlatformAdminPasswordAction(fd: FormData): Promise<void> {
  const actor = await requireSystemAdmin();
  const userId = value(fd, "user_id");
  const password = value(fd, "password");
  const passwordConfirmation = value(fd, "password_confirmation");
  if (!userId) throw new Error("缺少系統人員識別碼。");
  if (userId === actor.user.id) throw new Error("不可從人員名單重設目前登入帳號的密碼，避免誤鎖自己。");
  if (password.length < 8) throw new Error("新密碼至少需要 8 碼。");
  if (password !== passwordConfirmation) throw new Error("兩次輸入的新密碼不一致。");

  const service = createServiceClient();
  const { data: target, error: targetError } = await service
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (targetError) throw new Error(`查詢系統人員失敗：${targetError.message}`);
  if (!target) throw new Error("找不到系統人員或無權限操作。");

  const { error } = await service.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (error) throw new Error(`設定系統人員登入密碼失敗：${error.message}`);
  revalidatePath("/admin/platform/admins");
}

export async function sendPlatformPasswordSetupAction(fd: FormData): Promise<void> {
  const actor = await requireSystemAdmin();
  const userId = value(fd, "user_id");
  if (!userId) throw new Error("缺少系統人員識別碼。");
  if (userId === actor.user.id) throw new Error("不可從人員名單寄送目前登入帳號的設定密碼信。");

  const service = createServiceClient();
  const [{ data: target, error: targetError }, { data: authUser, error: authError }] = await Promise.all([
    service.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    service.auth.admin.getUserById(userId),
  ]);
  if (targetError) throw new Error(`查詢系統人員失敗：${targetError.message}`);
  if (!target) throw new Error("找不到系統人員或無權限操作。");
  if (authError || !authUser.user?.email) throw new Error(`讀取登入帳號失敗：${authError?.message ?? "缺少 Email"}`);

  const { error } = await service.auth.resetPasswordForEmail(authUser.user.email, {
    redirectTo: authInviteRedirectUrl(),
  });
  if (error) throw new Error(`寄送設定密碼信失敗：${error.message}`);
  revalidatePath("/admin/platform/admins");
}

export async function setPlatformAdminActiveAction(fd: FormData): Promise<void> {
  const actor = await requireSystemAdmin();
  const userId = value(fd, "user_id");
  const active = value(fd, "active") === "true";
  if (!userId) throw new Error("缺少系統人員識別碼。");
  if (userId === actor.user.id && !active) throw new Error("不能停用目前登入中的系統管理者。");

  const service = createServiceClient();
  if (!active) {
    const { data: target, error: targetError } = await service.from("platform_admins").select("access_type, active").eq("user_id", userId).maybeSingle();
    if (targetError) throw new Error(`查詢系統人員失敗：${targetError.message}`);
    if (target?.access_type === "system_admin" && target.active) {
      const { count, error: adminError } = await service.from("platform_admins").select("user_id", { count: "exact", head: true }).eq("access_type", "system_admin").eq("active", true);
      if (adminError) throw new Error(`查詢系統管理者失敗：${adminError.message}`);
      if ((count ?? 0) <= 1) throw new Error("系統至少要保留一位啟用中的系統管理者。");
    }
  }

  const { error } = await service.from("platform_admins").update({ active }).eq("user_id", userId);
  if (error) throw new Error(`更新系統人員失敗：${error.message}`);
  revalidatePath("/admin/platform/admins");
}
