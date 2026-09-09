import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { linkRichMenuToUser, unlinkRichMenuFromUser } from "@/lib/line";

export type LineMenuAudience = "member" | "staff";

/** Apply a ready per-user menu when the brand has published the conventional alias. */
export async function syncLineAudienceMenu(
  service: SupabaseClient,
  clinicId: string,
  lineUserId: string,
  audience: LineMenuAudience,
  accessToken: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("line_richmenu_aliases")
    .select("line_rich_menu_id")
    .eq("clinic_id", clinicId)
    .eq("alias_id", audience)
    .eq("status", "ready")
    .maybeSingle();
  if (error) throw new Error(`讀取 ${audience} LINE 選單失敗: ${error.message}`);
  const richMenuId = typeof data?.line_rich_menu_id === "string" ? data.line_rich_menu_id.trim() : "";
  if (!richMenuId) return false;
  await linkRichMenuToUser(lineUserId, richMenuId, accessToken);
  return true;
}

export async function resetLineAudienceMenu(lineUserId: string, accessToken: string): Promise<void> {
  await unlinkRichMenuFromUser(lineUserId, accessToken);
}
