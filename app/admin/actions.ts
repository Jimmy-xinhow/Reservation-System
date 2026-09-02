"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTIVE_CLINIC_COOKIE, requireAdmin, requireMember } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase-server";

function str(fd: FormData, k: string): string {
  return (fd.get(k) ?? "").toString().trim();
}
export async function setActiveClinicAction(fd: FormData): Promise<void> {
  const context = await requireMember();
  const clinicId = str(fd, "clinic_id");
  if (!context.clinics.some((clinic) => clinic.id === clinicId)) throw new Error("無權限切換此品牌");
  const store = await cookies();
  store.set(ACTIVE_CLINIC_COOKIE, clinicId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/admin");
}

/** 建立新品牌並將目前登入帳號設為該品牌管理者；實際交易由 DB function 原子完成。 */
export async function createBrandAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const name = str(fd, "name");
  const slug = str(fd, "slug").toLowerCase();
  const phone = str(fd, "phone");
  const address = str(fd, "address");
  if (!name || name.length > 120) throw new Error("品牌名稱必須為 1–120 字");
  if (!/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) throw new Error("品牌短網址只能使用英數字與連字號");
  if (phone.length > 80 || address.length > 240) throw new Error("品牌公開資訊過長");

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("create_brand_with_owner", {
    p_actor_user_id: member.user.id,
    p_source_clinic_id: member.clinicId,
    p_name: name,
    p_slug: slug,
    p_phone: phone || null,
    p_address: address || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("品牌短網址已存在");
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { clinic_id?: unknown } | null;
  if (!row || typeof row.clinic_id !== "string") throw new Error("品牌建立失敗");

  const store = await cookies();
  store.set(ACTIVE_CLINIC_COOKIE, row.clinic_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?brand_created=1");
}


// ── 登出 ──────────────────────────────────────────────────
export async function signOutAction() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
