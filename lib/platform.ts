import "server-only";

import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServer } from "./supabase-server";
import { createServiceClient } from "./supabase";
import {
  normalizeSystemPermissions,
  type PlatformAccessType,
  type SystemPermission,
} from "./platform-roles";

type LegacyPlatformRole = "owner" | "admin";

export interface PlatformContext {
  user: User;
  supabase: SupabaseClient;
  role: LegacyPlatformRole;
  accessType: PlatformAccessType;
  permissions: SystemPermission[];
}

export const PLATFORM_ADD_ONS = [
  { key: "specified_payment", label: "指定金流串接" },
  { key: "refund_reconciliation", label: "退款與對帳" },
  { key: "calendar_sync", label: "外部行事曆同步" },
  { key: "external_api", label: "外部 API／資料交換" },
  { key: "white_label", label: "進階白牌入口" },
  { key: "multilingual", label: "多語系介面" },
  { key: "industry_customization", label: "產業客製模組" },
] as const;

function envPlatformAdminIds(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function isMissingPlatformTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || Boolean(error?.message?.includes("platform_admins"));
}

async function findPlatformContext(): Promise<PlatformContext | null> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  if (envPlatformAdminIds().has(user.id)) {
    return { user, supabase, role: "admin", accessType: "system_admin", permissions: [] };
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("platform_admins")
      .select("role, access_type, permissions")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      if (isMissingPlatformTable(error)) return null;
      throw new Error(error.message);
    }
    if (!data || (data.role !== "owner" && data.role !== "admin")) return null;
    return {
      user,
      supabase,
      role: data.role,
      accessType: data.access_type === "employee" ? "employee" : "system_admin",
      permissions: normalizeSystemPermissions(data.permissions),
    };
  } catch (error) {
    if (error instanceof Error && /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL/.test(error.message)) return null;
    throw error;
  }
}

export async function getOptionalPlatformAdmin(): Promise<PlatformContext | null> {
  return findPlatformContext();
}

export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const context = await findPlatformContext();
  if (!context) redirect("/admin/login?reason=platform-access-required");
  return context;
}

export function hasSystemPermission(context: Pick<PlatformContext, "accessType" | "permissions">, permission: SystemPermission): boolean {
  return context.accessType === "system_admin" || context.permissions.includes(permission);
}

export async function requireSystemAdmin(): Promise<PlatformContext> {
  const context = await requirePlatformAdmin();
  if (context.accessType !== "system_admin") {
    await recordPlatformPermissionDenied(context);
    redirect("/admin/platform?notice=permission");
  }
  return context;
}

export async function requireSystemPermission(permission: SystemPermission): Promise<PlatformContext> {
  const context = await requirePlatformAdmin();
  if (!hasSystemPermission(context, permission)) {
    await recordPlatformPermissionDenied(context);
    redirect("/admin/platform?notice=permission");
  }
  return context;
}

async function recordPlatformPermissionDenied(context: PlatformContext): Promise<void> {
  try {
    const member = await context.supabase.from("clinic_members").select("clinic_id").eq("user_id", context.user.id).limit(1).maybeSingle();
    if (!member.data?.clinic_id) return;
    await createServiceClient().from("admin_product_events").insert({
      clinic_id: member.data.clinic_id,
      event_name: "permission_denied",
      session_id: `server_${crypto.randomUUID().replaceAll("-", "")}`,
      actor_scope: context.accessType === "system_admin" ? "system_admin" : "system_employee",
      metadata: { scope: "platform" },
    });
  } catch {
    // Permission enforcement remains fail-closed when telemetry is unavailable.
  }
}
