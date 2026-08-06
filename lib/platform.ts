import "server-only";

import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServer } from "./supabase-server";
import { createServiceClient } from "./supabase";

export type PlatformRole = "owner" | "admin";

export interface PlatformContext {
  user: User;
  supabase: SupabaseClient;
  role: PlatformRole;
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
    return { user, supabase, role: "owner" };
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("platform_admins")
      .select("role")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      if (isMissingPlatformTable(error)) return null;
      throw new Error(error.message);
    }
    if (!data || (data.role !== "owner" && data.role !== "admin")) return null;
    return { user, supabase, role: data.role };
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
  if (!context) redirect("/admin/login");
  return context;
}

