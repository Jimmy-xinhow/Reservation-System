"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";
import { requirePlatformOwner } from "@/lib/platform";

function value(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

export async function upsertPlatformAdminAction(fd: FormData): Promise<void> {
  await requirePlatformOwner();
  const email = value(fd, "email").toLowerCase();
  const role = value(fd, "role");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("請輸入有效的系統管理員 Email。");
  if (role !== "owner" && role !== "admin") throw new Error("平台角色不合法。");

  const service = createServiceClient();
  const { data: users, error: usersError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw new Error(`查詢使用者失敗：${usersError.message}`);
  let user = users.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
  if (!user) {
    const { data, error } = await service.auth.admin.inviteUserByEmail(email);
    if (error || !data.user) throw new Error(`寄送平台管理員邀請失敗：${error?.message ?? "找不到使用者"}`);
    user = data.user;
  }

  const { error } = await service.from("platform_admins").upsert({ user_id: user.id, role, active: true }, { onConflict: "user_id" });
  if (error) throw new Error(`儲存平台管理員失敗：${error.message}`);
  revalidatePath("/admin/platform/admins");
  revalidatePath("/admin/platform");
}

export async function setPlatformAdminActiveAction(fd: FormData): Promise<void> {
  const actor = await requirePlatformOwner();
  const userId = value(fd, "user_id");
  const active = value(fd, "active") === "true";
  if (!userId) throw new Error("缺少平台管理員識別碼。");
  if (userId === actor.user.id && !active) throw new Error("不能停用目前登入中的平台擁有者。");

  const service = createServiceClient();
  if (!active) {
    const { data: target, error: targetError } = await service.from("platform_admins").select("role, active").eq("user_id", userId).maybeSingle();
    if (targetError) throw new Error(`查詢平台管理員失敗：${targetError.message}`);
    if (target?.role === "owner" && target.active) {
      const { count, error: ownerError } = await service.from("platform_admins").select("user_id", { count: "exact", head: true }).eq("role", "owner").eq("active", true);
      if (ownerError) throw new Error(`查詢平台擁有者失敗：${ownerError.message}`);
      if ((count ?? 0) <= 1) throw new Error("平台至少要保留一位啟用中的 owner。");
    }
  }

  const { error } = await service.from("platform_admins").update({ active }).eq("user_id", userId);
  if (error) throw new Error(`更新平台管理員失敗：${error.message}`);
  revalidatePath("/admin/platform/admins");
}
