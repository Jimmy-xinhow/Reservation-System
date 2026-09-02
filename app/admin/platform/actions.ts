"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase";
import { PLATFORM_ADD_ONS, requireSystemPermission } from "@/lib/platform";
import { authInviteRedirectUrl } from "@/lib/auth-invite";

function value(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

function checked(fd: FormData, key: string): boolean {
  return fd.get(key) === "on";
}

export async function createPlatformBrandAction(fd: FormData): Promise<void> {
  const platform = await requireSystemPermission("brands.manage");
  const name = value(fd, "name");
  const slug = value(fd, "slug").toLowerCase();
  const ownerEmail = value(fd, "owner_email").toLowerCase();
  const phone = value(fd, "phone");
  const address = value(fd, "address");

  if (!name || name.length > 120) throw new Error("品牌名稱必須填寫，且不可超過 120 字。");
  if (!/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) throw new Error("品牌代號只能使用小寫英文、數字與連字號。");
  if (!/^\S+@\S+\.\S+$/.test(ownerEmail)) throw new Error("請填寫有效的品牌管理者 Email。");
  if (phone.length > 80 || address.length > 240) throw new Error("聯絡資料長度超過限制。");

  const service = createServiceClient();
  const { data: users, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(`查詢品牌管理者失敗：${listError.message}`);
  let owner = users.users.find((user) => user.email?.toLowerCase() === ownerEmail) ?? null;
  if (!owner) {
    const { data, error } = await service.auth.admin.inviteUserByEmail(ownerEmail, {
      redirectTo: authInviteRedirectUrl(),
    });
    if (error || !data.user) throw new Error(`寄送品牌管理者邀請失敗：${error?.message ?? "無法建立使用者"}`);
    owner = data.user;
  }

  const { data, error } = await service.rpc("create_brand_with_platform_admin", {
    p_actor_user_id: platform.user.id,
    p_owner_user_id: owner.id,
    p_name: name,
    p_slug: slug,
    p_phone: phone || null,
    p_address: address || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("品牌代號已存在，請換一個。");
    throw new Error(`建立品牌失敗：${error.message}`);
  }
  if (!data) throw new Error("建立品牌失敗：資料庫沒有回傳品牌資料。");
  revalidatePath("/admin/platform");
  redirect("/admin/platform?section=brands&created=1");
}

export async function setPlatformBrandActiveAction(fd: FormData): Promise<void> {
  await requireSystemPermission("brands.manage");
  const clinicId = value(fd, "clinic_id");
  const active = value(fd, "active") === "true";
  if (!clinicId) throw new Error("缺少品牌識別碼。");
  const { error } = await createServiceClient().from("clinics").update({ active }).eq("id", clinicId);
  if (error) throw new Error(`更新品牌狀態失敗：${error.message}`);
  revalidatePath("/admin/platform");
}

export async function updatePlatformEntitlementAction(fd: FormData): Promise<void> {
  await requireSystemPermission("entitlements.manage");
  const clinicId = value(fd, "clinic_id");
  const planCode = value(fd, "plan_code");
  const note = value(fd, "note");
  if (!clinicId) throw new Error("缺少品牌識別碼。");
  if (!["standard", "professional", "enterprise"].includes(planCode)) throw new Error("方案代碼不正確。");
  const featureFlags = Object.fromEntries(PLATFORM_ADD_ONS.map(({ key }) => [key, checked(fd, key)]));
  const { error } = await createServiceClient().from("brand_entitlements").upsert({
    clinic_id: clinicId,
    plan_code: planCode,
    feature_flags: featureFlags,
    note: note || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "clinic_id" });
  if (error) throw new Error(`更新品牌方案失敗：${error.message}`);
  revalidatePath("/admin/platform");
}
