import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminModuleKey = "events" | "memberships" | "crm" | "line";

interface ModuleSettingsRow {
  events_enabled: boolean;
  memberships_enabled: boolean;
  crm_automation_enabled: boolean;
  line_channel_enabled: boolean;
}

export async function isAdminModuleEnabled(
  supabase: SupabaseClient,
  clinicId: string,
  module: AdminModuleKey,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("clinic_settings")
    .select("events_enabled, memberships_enabled, crm_automation_enabled, line_channel_enabled")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("品牌設定不存在");
  const settings = data as ModuleSettingsRow;
  if (module === "events") return settings.events_enabled;
  if (module === "memberships") return settings.memberships_enabled;
  if (module === "crm") return settings.crm_automation_enabled;
  return settings.line_channel_enabled;
}
