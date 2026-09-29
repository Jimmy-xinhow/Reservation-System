import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Only a verified domain owned by this brand may receive a gateway browser return. */
export async function verifiedPaymentCustomerOrigin(
  request: NextRequest,
  service: SupabaseClient,
  clinicId: string,
): Promise<string | null> {
  const rawHost = request.headers.get("host")?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9.-]+$/.test(rawHost) || rawHost.length > 253) return null;

  const { data, error } = await service.from("clinic_domains")
    .select("hostname")
    .eq("hostname", rawHost)
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .not("verified_at", "is", null)
    .maybeSingle();
  if (error || !data) return null;
  return `https://${rawHost}`;
}
