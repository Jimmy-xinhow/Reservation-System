import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyLiffIdToken, type VerifiedLineProfile } from "@/lib/line";

export type LineConnectionMode = "shared" | "brand";
export type LineVerificationStatus = "unconfigured" | "pending" | "ready" | "error";

interface ClinicRow {
  line_destination: string | null;
  slug: string | null;
}

interface SettingsRow {
  line_channel_enabled: boolean;
}

interface ChannelRow {
  connection_mode: LineConnectionMode;
  login_channel_id: string | null;
  liff_id: string | null;
  liff_endpoint_path: string;
  verification_status: LineVerificationStatus;
}

export interface ClinicLineChannelContext {
  clinicId: string;
  clinicSlug: string | null;
  destination: string | null;
  enabled: boolean;
  connectionMode: LineConnectionMode;
  loginChannelId: string | null;
  liffId: string | null;
  liffEndpointPath: string;
  verificationStatus: LineVerificationStatus;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * Resolve non-secret LINE/LIFF metadata for one brand.
 * Shared channels may use the legacy environment fallback. Brand channels must
 * carry their own Login Channel and LIFF IDs and therefore fail closed.
 */
export async function getClinicLineChannelContext(
  service: SupabaseClient,
  clinicId: string,
): Promise<ClinicLineChannelContext> {
  const [clinicResult, settingsResult, channelResult] = await Promise.all([
    service.from("clinics").select("line_destination, slug").eq("id", clinicId).eq("active", true).maybeSingle(),
    service.from("clinic_settings").select("line_channel_enabled").eq("clinic_id", clinicId).maybeSingle(),
    service
      .from("clinic_line_channels")
      .select("connection_mode, login_channel_id, liff_id, liff_endpoint_path, verification_status")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
  ]);
  if (clinicResult.error) throw new Error(clinicResult.error.message);
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (channelResult.error) throw new Error(channelResult.error.message);
  if (!clinicResult.data) throw new Error("找不到啟用中的品牌");

  const clinic = clinicResult.data as ClinicRow;
  const settings = settingsResult.data as SettingsRow | null;
  const channel = channelResult.data as ChannelRow | null;
  const connectionMode = channel?.connection_mode === "brand" ? "brand" : "shared";
  const sharedLoginChannelId = clean(process.env.LINE_LOGIN_CHANNEL_ID);
  const sharedLiffId = clean(process.env.NEXT_PUBLIC_LIFF_ID);

  return {
    clinicId,
    clinicSlug: clean(clinic.slug),
    destination: clean(clinic.line_destination),
    enabled: settings?.line_channel_enabled === true,
    connectionMode,
    loginChannelId: clean(channel?.login_channel_id) ?? (connectionMode === "shared" ? sharedLoginChannelId : null),
    liffId: clean(channel?.liff_id) ?? (connectionMode === "shared" ? sharedLiffId : null),
    liffEndpointPath: clean(channel?.liff_endpoint_path) ?? "/book",
    verificationStatus: channel?.verification_status ?? "unconfigured",
  };
}

export async function verifyClinicLiffIdToken(
  service: SupabaseClient,
  clinicId: string,
  idToken: string,
): Promise<VerifiedLineProfile> {
  const context = await getClinicLineChannelContext(service, clinicId);
  if (!context.enabled) throw new Error("此品牌尚未啟用 LINE／LIFF");
  if (!context.loginChannelId) {
    throw new Error(context.connectionMode === "brand" ? "此品牌尚未設定 LINE Login Channel" : "缺少 LINE_LOGIN_CHANNEL_ID");
  }
  return verifyLiffIdToken(idToken, context.loginChannelId);
}

export function clinicLiffUrl(
  context: Pick<ClinicLineChannelContext, "liffId" | "clinicSlug">,
  params?: Record<string, string | null | undefined>,
): string | null {
  if (!context.liffId) return null;
  const url = new URL(`https://liff.line.me/${context.liffId}`);
  if (context.clinicSlug) url.searchParams.set("clinic_slug", context.clinicSlug);
  for (const [key, value] of Object.entries(params ?? {})) {
    const normalized = clean(value);
    if (normalized) url.searchParams.set(key, normalized);
  }
  return url.toString();
}
