import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PublicBrandScope {
  clinicSlug?: string | null;
  clinicId?: string | null;
  host?: string | null;
}

function isSharedHost(host: string): boolean {
  if (!host) return true;
  if (["localhost", "127.0.0.1", "[::1]"].includes(host) || host.endsWith(".vercel.app")) return true;
  const configuredHosts = (process.env.PUBLIC_SHARED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configuredHosts.includes(host);
}

export async function resolvePublicClinicIdFromScope(supabase: SupabaseClient, scope: PublicBrandScope): Promise<string | null> {
  const slug = scope.clinicSlug?.trim();
  const clinicId = scope.clinicId?.trim();
  const host = (scope.host ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  const configuredClinicId = process.env.NEXT_PUBLIC_CLINIC_ID?.trim() || "";
  if (host) {
    const { data: domain, error: domainError } = await supabase.from("clinic_domains").select("clinic_id, verified_at").eq("hostname", host).eq("active", true).not("verified_at", "is", null).maybeSingle();
    if (domainError) return null;
    if (domain?.clinic_id) {
      const { data: clinic, error: clinicError } = await supabase.from("clinics").select("id").eq("id", domain.clinic_id).eq("active", true).maybeSingle();
      if (clinicError) return null;
      const hostClinicId = (clinic?.id as string | undefined) ?? null;
      if (!hostClinicId) return null;
      const { data: slugClinic, error: slugError } = slug
        ? await supabase.from("clinics").select("id").eq("slug", slug).eq("active", true).maybeSingle()
        : { data: null, error: null };
      if (slugError) return null;
      const { data: idClinic, error: idError } = clinicId
        ? await supabase.from("clinics").select("id").eq("id", clinicId).eq("active", true).maybeSingle()
        : { data: null, error: null };
      if (idError) return null;
      if ((slug && slugClinic?.id !== hostClinicId) || (clinicId && idClinic?.id !== hostClinicId)) return null;
      return hostClinicId;
    }
    if (!isSharedHost(host)) return null;
  }
  const { data: slugClinic, error: slugError } = slug
    ? await supabase.from("clinics").select("id").eq("slug", slug).eq("active", true).maybeSingle()
    : { data: null, error: null };
  if (slugError) return null;
  const { data: idClinic, error: idError } = clinicId
    ? await supabase.from("clinics").select("id").eq("id", clinicId).eq("active", true).maybeSingle()
    : { data: null, error: null };
  if (idError) return null;
  if (slug && clinicId && slugClinic?.id !== idClinic?.id) return null;
  if (slug) return (slugClinic?.id as string | undefined) ?? null;
  if (clinicId && clinicId !== configuredClinicId) return null;
  if (clinicId) return (idClinic?.id as string | undefined) ?? null;

  // URL clinic_id 只可作為相容輸入，不能用來任意選擇租戶；正式 SaaS 必須使用 slug 或已驗證網域。
  return configuredClinicId || null;
}

export async function resolvePublicClinicId(req: NextRequest, supabase: SupabaseClient): Promise<string | null> {
  return resolvePublicClinicIdFromScope(supabase, {
    clinicSlug: req.nextUrl.searchParams.get("clinic_slug"),
    clinicId: req.nextUrl.searchParams.get("clinic_id"),
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
  });
}
