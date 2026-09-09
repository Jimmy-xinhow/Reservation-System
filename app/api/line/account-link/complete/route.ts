import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicIdFromScope } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function retryUrl(request: NextRequest, clinicSlug: string, linkToken: string): URL {
  const url = new URL("/line/account-link", request.url);
  url.searchParams.set("clinic_slug", clinicSlug);
  url.searchParams.set("linkToken", linkToken);
  url.searchParams.set("error", "identity");
  return url;
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "line:account-link", 6, 10 * 60_000);
  const form = await request.formData().catch(() => null);
  const clinicSlug = String(form?.get("clinic_slug") ?? "").trim();
  const linkToken = String(form?.get("link_token") ?? "").trim();
  if (!rate.allowed) return Response.redirect(retryUrl(request, clinicSlug, linkToken), 303);

  const name = String(form?.get("name") ?? "").trim();
  const phone = String(form?.get("phone") ?? "").trim();
  const birthday = String(form?.get("birthday") ?? "").trim();
  if (!clinicSlug || clinicSlug.length > 100 || !linkToken || linkToken.length > 2048 || /\s/.test(linkToken)) {
    return new Response("invalid account link request", { status: 400 });
  }
  if (!name || name.length > 100 || !phone || phone.length > 40 || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return Response.redirect(retryUrl(request, clinicSlug, linkToken), 303);
  }

  const service = createServiceClient();
  const clinicId = await resolvePublicClinicIdFromScope(service, { clinicSlug, host: request.nextUrl.host });
  if (!clinicId) return new Response("brand not found", { status: 404 });

  const { data: patient, error: patientError } = await service
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("name", name)
    .eq("phone", phone)
    .eq("birthday", birthday)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (patientError) return new Response("account link unavailable", { status: 503 });
  if (!patient?.id) return Response.redirect(retryUrl(request, clinicSlug, linkToken), 303);

  const nonce = randomBytes(32).toString("base64url");
  const nonceHash = createHash("sha256").update(nonce).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { error: nonceError } = await service.from("line_account_link_nonces").insert({
    clinic_id: clinicId,
    patient_id: patient.id,
    nonce_hash: nonceHash,
    expires_at: expiresAt,
  });
  if (nonceError) return new Response("account link unavailable", { status: 503 });

  const accountLink = new URL("https://access.line.me/dialog/bot/accountLink");
  accountLink.searchParams.set("linkToken", linkToken);
  accountLink.searchParams.set("nonce", nonce);
  return Response.redirect(accountLink, 303);
}
