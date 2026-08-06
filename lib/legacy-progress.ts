import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export async function isLegacyProgressEnabled(supabase: SupabaseClient, clinicId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("clinic_settings")
    .select("legacy_progress_enabled")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return !error && data?.legacy_progress_enabled === true;
}
