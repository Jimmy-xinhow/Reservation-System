import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServer } from "./supabase-server";
import { CLINIC_ID, createServiceClient } from "./supabase";
import {
  normalizeBrandPermissions,
  permissionsForLegacyBrandRole,
  type BrandAccessType,
  type BrandPermission,
} from "./access-control";

export const ACTIVE_CLINIC_COOKIE = "active_clinic_id";

export type Role = "owner" | "admin" | "frontdesk" | "provider" | "staff";

export interface AccessibleClinic {
  id: string;
  name: string;
  active: boolean;
  role: Role;
  accessType: BrandAccessType;
  permissions: BrandPermission[];
}

export interface MemberContext {
  user: User;
  supabase: SupabaseClient;
  clinicId: string;
  clinicName: string;
  role: Role;
  accessType: BrandAccessType;
  permissions: BrandPermission[];
  clinics: AccessibleClinic[];
}

async function recordPermissionDenied(context: MemberContext): Promise<void> {
  try {
    await createServiceClient().from("admin_product_events").insert({
      clinic_id: context.clinicId,
      event_name: "permission_denied",
      session_id: `server_${crypto.randomUUID().replaceAll("-", "")}`,
      actor_scope: context.accessType === "brand_admin" ? "brand_admin" : "brand_employee",
      metadata: {},
    });
  } catch {
    // Permission enforcement remains fail-closed when telemetry is unavailable.
  }
}

function normalizeRole(value: unknown): Role {
  if (value === "owner" || value === "admin" || value === "frontdesk" || value === "provider") return value;
  return "staff";
}

function isAdminRole(role: Role): boolean {
  return role === "owner" || role === "admin";
}

function normalizeBrandAccessType(value: unknown, role: Role): BrandAccessType {
  if (value === "brand_admin" || value === "employee") return value;
  return isAdminRole(role) ? "brand_admin" : "employee";
}

async function findMemberContext(): Promise<MemberContext | null> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("clinic_members")
    .select("clinic_id, role, access_type, permissions, clinics(name, active)")
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    clinic_id: string;
    role: string;
    access_type: string | null;
    permissions: string[] | null;
    clinics: { name: string; active: boolean } | { name: string; active: boolean }[] | null;
  }>;
  const clinics = rows
    .map((row) => {
      const clinic = Array.isArray(row.clinics) ? row.clinics[0] : row.clinics;
      const role = normalizeRole(row.role);
      const permissions = normalizeBrandPermissions(row.permissions);
      return {
        id: row.clinic_id,
        name: clinic?.name ?? "未命名品牌",
        active: clinic?.active !== false,
        role,
        accessType: normalizeBrandAccessType(row.access_type, role),
        permissions: permissions.length > 0 ? permissions : permissionsForLegacyBrandRole(role),
      } satisfies AccessibleClinic;
    })
    .filter((clinic) => clinic.active);
  if (clinics.length === 0) return null;

  const cookieStore = await cookies();
  const requestedId = cookieStore.get(ACTIVE_CLINIC_COOKIE)?.value;
  const selected =
    clinics.find((clinic) => clinic.id === requestedId) ??
    clinics.find((clinic) => clinic.id === CLINIC_ID) ??
    clinics[0];
  if (!selected) return null;

  return {
    user,
    supabase,
    clinicId: selected.id,
    clinicName: selected.name,
    role: selected.role,
    accessType: selected.accessType,
    permissions: selected.permissions,
    clinics,
  };
}

/** Optional auth context for layouts that need to render login-safe chrome. */
export async function getOptionalMember(): Promise<MemberContext | null> {
  try {
    return await findMemberContext();
  } catch (error) {
    if (error instanceof Error && error.message.includes("缺少 NEXT_PUBLIC_SUPABASE_URL")) return null;
    throw error;
  }
}

/** Required authenticated member and active brand context. */
export async function requireMember(): Promise<MemberContext> {
  const context = await findMemberContext();
  if (!context) redirect("/admin/login?reason=brand-access-required");
  return context;
}

/** Required authenticated staff member allowed to change operational data. */
export async function requireOperator(): Promise<MemberContext> {
  const context = await requireMember();
  if (!hasBrandPermission(context, "operations.manage") && !hasBrandPermission(context, "brand.manage")) throw new Error("目前帳號沒有日常營運權限");
  return context;
}

/** Provider 可在被指派的預約上執行完成／未到狀態，其餘修改仍禁止。 */
export async function requireStatusOperator(): Promise<MemberContext> {
  const context = await requireMember();
  if (!["provider.assigned", "operations.manage", "brand.manage"].some((permission) => hasBrandPermission(context, permission as BrandPermission))) throw new Error("目前帳號沒有狀態更新權限");
  return context;
}

/** Required owner/admin access. */
export async function requireAdmin(): Promise<MemberContext> {
  const context = await requireMember();
  if (!hasBrandPermission(context, "brand.manage")) {
    await recordPermissionDenied(context);
    redirect("/admin/dashboard?notice=permission");
  }
  return context;
}

/** Only a brand administrator may add people or change employee permissions. */
export async function requireBrandAdmin(): Promise<MemberContext> {
  const context = await requireMember();
  if (context.accessType !== "brand_admin") {
    await recordPermissionDenied(context);
    redirect("/admin/dashboard?notice=permission");
  }
  return context;
}

/** Provider pages must use an explicit doctor assignment; an empty assignment is fail-closed. */
export async function getAssignedDoctorIds(context: MemberContext): Promise<string[]> {
  if (!hasBrandPermission(context, "provider.assigned")) return [];
  const { data, error } = await context.supabase
    .from("doctor_assignments")
    .select("doctor_id")
    .eq("clinic_id", context.clinicId)
    .eq("user_id", context.user.id)
    .eq("active", true);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => row.doctor_id as string))];
}

/** Routes outside provider operations must not expose brand-wide data. */
export async function requireNonProvider(): Promise<MemberContext> {
  const context = await requireMember();
  if (!hasBrandPermission(context, "operations.manage") && !hasBrandPermission(context, "brand.manage")) {
    await recordPermissionDenied(context);
    redirect("/admin/dashboard?notice=permission");
  }
  return context;
}

export function hasBrandPermission(context: Pick<MemberContext, "accessType" | "permissions">, permission: BrandPermission): boolean {
  return context.accessType === "brand_admin" || context.permissions.includes(permission);
}

export function canManageSettings(role: Role): boolean {
  return isAdminRole(role);
}

export function canOperate(role: Role): boolean {
  return role !== "provider";
}

export function canViewSensitiveCustomerData(role: Role): boolean {
  return role !== "provider";
}
