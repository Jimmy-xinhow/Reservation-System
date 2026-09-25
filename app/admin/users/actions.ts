"use server";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";


import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBrandAdmin, type Role } from "@/lib/admin";
import {
  legacyBrandRoleForPermissions,
  normalizeBrandPermissions,
  permissionsForLegacyBrandRole,
  type BrandAccessType,
  type BrandPermission,
} from "@/lib/access-control";
import { createServiceClient } from "@/lib/supabase";
import { authInviteRedirectUrl } from "@/lib/auth-invite";

function str(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

export interface StaffMember {
  userId: string;
  email: string;
  role: Role;
  accessType: BrandAccessType;
  permissions: BrandPermission[];
  isSelf: boolean;
  createdAt: string | null;
  assignedDoctors: Array<{ id: string; name: string }>;
}

function brandAccessInput(fd: FormData): { accessType: BrandAccessType; permissions: BrandPermission[]; legacyRole: Role } {
  const accessType: BrandAccessType = str(fd, "access_type") === "brand_admin" ? "brand_admin" : "employee";
  const permissions = accessType === "brand_admin"
    ? (["brand.manage", "operations.manage"] as BrandPermission[])
    : normalizeBrandPermissions(fd.getAll("permissions").map((value) => value.toString()));
  if (accessType === "employee" && permissions.length === 0) throw new Error("品牌員工至少要有一項工作權限");
  return { accessType, permissions, legacyRole: legacyBrandRoleForPermissions(accessType, permissions) };
}

/** 本品牌目前的品牌管理者人數，用於避免管理權限完全中斷。 */
async function adminCount(service: SupabaseClient, clinicId: string): Promise<number> {
  const { count } = await adminQuery(service
    .from("clinic_members")
    .select("user_id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("access_type", "brand_admin"));
  return count ?? 0;
}

export async function listStaff(): Promise<StaffMember[]> {
  const { user, clinicId } = await requireBrandAdmin();
  const service = await adminQuery(Promise.resolve().then(() => createServiceClient()));
  const { data: members, error: membersError } = await adminQuery(service
    .from("clinic_members")
    .select("user_id, role, access_type, permissions, created_at")
    .eq("clinic_id", clinicId));
  if (membersError) throw new Error(adminErrorMessage(membersError));
  const rows = members ?? [];
  if (rows.length === 0) return [];

  // Resolve only this brand's members, with bounded Auth concurrency.
  const emailByUserId = new Map<string, string>();
  const userIds = [...new Set(rows.map((member) => member.user_id as string))];
  for (let offset = 0; offset < userIds.length; offset += 8) {
    await adminQuery(Promise.all(userIds.slice(offset, offset + 8).map(async (userId) => {
      const { data, error } = await service.auth.admin.getUserById(userId);
      if (error || !data?.user || data.user.id !== userId) {
        throw new Error(adminErrorMessage(error ?? "品牌成員帳號載入失敗"));
      }
      emailByUserId.set(userId, data.user.email ?? "");
    })));
  }
  const [{ data: doctors, error: doctorsError }, { data: assignments, error: assignmentsError }] = await adminQuery(Promise.all([
    service.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("doctor_assignments").select("user_id, doctor_id").eq("clinic_id", clinicId).eq("active", true),
  ]));
  if (doctorsError || assignmentsError) throw new Error(adminErrorMessage(doctorsError ?? assignmentsError));
  const doctorNames = new Map((doctors ?? []).map((doctor) => [doctor.id as string, doctor.name as string]));
  const assignedByUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const assignment of assignments ?? []) {
    const doctorId = assignment.doctor_id as string;
    const name = doctorNames.get(doctorId);
    if (!name) continue;
    const current = assignedByUser.get(assignment.user_id as string) ?? [];
    current.push({ id: doctorId, name });
    assignedByUser.set(assignment.user_id as string, current);
  }

  return rows.map((member) => {
    const role = (member.role === "owner" || member.role === "admin" || member.role === "frontdesk" || member.role === "provider" || member.role === "staff"
      ? member.role
      : "staff") as Role;
    const permissions = normalizeBrandPermissions(member.permissions);
    return {
      userId: member.user_id as string,
      email: emailByUserId.get(member.user_id as string) ?? "(未知)",
      role,
      accessType: member.access_type === "brand_admin" ? "brand_admin" : "employee",
      permissions: permissions.length > 0 ? permissions : permissionsForLegacyBrandRole(role),
      isSelf: member.user_id === user.id,
      createdAt: (member.created_at as string) ?? null,
      assignedDoctors: assignedByUser.get(member.user_id as string) ?? [],
    };
  });
}

export async function listClinicDoctors(): Promise<Array<{ id: string; name: string }>> {
  const { clinicId } = await requireBrandAdmin();
  const service = await adminQuery(Promise.resolve().then(() => createServiceClient()));
  const { data, error } = await adminQuery(service
    .from("doctors")
    .select("id, name")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("name"));
  if (error) throw new Error(adminErrorMessage(error));
  return (data ?? []).map((doctor) => ({ id: doctor.id as string, name: doctor.name as string }));
}

export async function createStaffAction(fd: FormData) {
  const { clinicId } = await requireBrandAdmin();
  const email = str(fd, "email").toLowerCase();
  const { accessType, permissions, legacyRole } = brandAccessInput(fd);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("請填正確 Email");

  const service = createServiceClient();
  let userId: string | null = null;
  let invited = false;
  let page = 1;
  while (!userId) {
    const { data, error } = await adminQuery(service.auth.admin.listUsers({ page, perPage: 1000 }));
    if (error || !data) throw new Error(adminErrorMessage(error ?? "查詢登入帳號失敗"));
    userId = data.users.find((authUser) => authUser.email?.toLowerCase() === email)?.id ?? null;
    if (userId || !data.nextPage) break;
    page = data.nextPage;
  }
  if (!userId) {
    const { data, error } = await adminQuery(service.auth.admin.inviteUserByEmail(email, {
      redirectTo: authInviteRedirectUrl(),
    }));
    if (error || !data.user) throw new Error(adminErrorMessage(error ?? "寄送員工邀請失敗"));
    userId = data.user.id;
    invited = true;
  }

  const { error: memberError } = await adminQuery(service.from("clinic_members").upsert(
    { clinic_id: clinicId, user_id: userId, role: legacyRole, access_type: accessType, permissions },
    { onConflict: "clinic_id,user_id" },
  ));
  if (memberError) throw new Error(adminErrorMessage(memberError));
  revalidatePath("/admin/users");
  redirect(`/admin/users?notice=${invited ? "invited" : "existing"}`);
}

export async function setStaffRoleAction(fd: FormData) {
  const { user, clinicId } = await requireBrandAdmin();
  const userId = str(fd, "user_id");
  const { accessType, permissions, legacyRole } = brandAccessInput(fd);
  if (!userId) throw new Error("缺少帳號");
  if (userId === user.id) throw new Error("不可變更目前登入帳號的管理身分");

  const service = createServiceClient();
  const { data: currentTarget } = await adminQuery(service
    .from("clinic_members")
    .select("access_type")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle());
  if (currentTarget?.access_type === "brand_admin" && accessType !== "brand_admin" && (await adminCount(service, clinicId)) <= 1) {
    throw new Error("至少要保留一位品牌管理者");
  }
  const { error } = await adminQuery(service
    .from("clinic_members")
    .update({ role: legacyRole, access_type: accessType, permissions })
    .eq("clinic_id", clinicId)
    .eq("user_id", userId));
  if (error) throw new Error(adminErrorMessage(error));
  revalidatePath("/admin/users");
}

export async function setDoctorAssignmentsAction(fd: FormData) {
  const { clinicId } = await requireBrandAdmin();
  const userId = str(fd, "user_id");
  if (!userId) throw new Error("缺少帳號");
  const selectedDoctorIds = [...new Set(fd.getAll("doctor_ids").map((value) => value.toString()).filter(Boolean))];
  const service = createServiceClient();
  const { data: target } = await adminQuery(service
    .from("clinic_members")
    .select("permissions")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle());
  if (!normalizeBrandPermissions(target?.permissions).includes("provider.assigned")) {
    throw new Error("只有具備指派工作權限的品牌員工可設定服務人員");
  }
  const { data: doctors, error: doctorError } = await adminQuery(service
    .from("doctors")
    .select("id")
    .eq("clinic_id", clinicId)
    .in("id", selectedDoctorIds.length > 0 ? selectedDoctorIds : ["00000000-0000-0000-0000-000000000000"]));
  if (doctorError) throw new Error(adminErrorMessage(doctorError));
  const allowedIds = new Set((doctors ?? []).map((doctor) => doctor.id as string));
  const validIds = selectedDoctorIds.filter((id) => allowedIds.has(id));

  const { error: clearError } = await adminQuery(service
    .from("doctor_assignments")
    .update({ active: false })
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("active", true));
  if (clearError) throw new Error(adminErrorMessage(clearError));
  if (validIds.length > 0) {
    const { error: upsertError } = await adminQuery(service.from("doctor_assignments").upsert(
      validIds.map((doctorId) => ({ clinic_id: clinicId, doctor_id: doctorId, user_id: userId, active: true })),
      { onConflict: "clinic_id,doctor_id,user_id" },
    ));
    if (upsertError) throw new Error(adminErrorMessage(upsertError));
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/queue");
}

export async function removeStaffAction(fd: FormData) {
  const { user, clinicId } = await requireBrandAdmin();
  const userId = str(fd, "user_id");
  if (!userId) throw new Error("缺少帳號");
  if (userId === user.id) throw new Error("無法移除自己");

  const service = createServiceClient();
  const { data: target } = await adminQuery(service
    .from("clinic_members")
    .select("access_type")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle());
  if (target?.access_type === "brand_admin" && (await adminCount(service, clinicId)) <= 1) {
    throw new Error("至少要保留一位品牌管理者");
  }
  const { error } = await adminQuery(service
    .from("clinic_members")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("user_id", userId));
  if (error) throw new Error(adminErrorMessage(error));
  revalidatePath("/admin/users");
}

export async function sendStaffPasswordSetupAction(fd: FormData) {
  const { user, clinicId } = await requireBrandAdmin();
  const userId = str(fd, "user_id");
  if (!userId) throw new Error("缺少帳號");
  if (userId === user.id) throw new Error("請從個人帳號頁設定自己的密碼");

  const service = createServiceClient();
  const { data: target, error: targetError } = await adminQuery(service
    .from("clinic_members")
    .select("access_type")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle());
  if (targetError) throw new Error(adminErrorMessage(targetError));
  if (!target) throw new Error("找不到目標成員或無權限操作");
  if (target.access_type === "brand_admin") throw new Error("管理者請從個人帳號頁自行設定密碼");
  const { data: authUser, error: authError } = await adminQuery(service.auth.admin.getUserById(userId));
  if (authError || !authUser.user?.email) throw new Error(adminErrorMessage(authError ?? "讀取登入帳號失敗"));
  const { error } = await adminQuery(service.auth.resetPasswordForEmail(authUser.user.email, {
    redirectTo: authInviteRedirectUrl(),
  }));
  if (error) throw new Error(adminErrorMessage(error));
  revalidatePath("/admin/users");
  redirect("/admin/users?notice=password-email");
}
