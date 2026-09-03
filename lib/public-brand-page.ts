import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brandPagePreferredEntry,
  isBrandPageTemplate,
  normalizeBrandPageContent,
  type BrandPageEvent,
  type BrandPageLinks,
  type BrandPageService,
  type PublicBrandPageData,
} from "@/lib/brand-page";

interface ClinicRow {
  name: string;
  slug: string | null;
  line_basic_id: string | null;
  phone: string | null;
  address: string | null;
  intro: string | null;
}

interface BrandPageSettingsRow {
  brand_page_enabled: boolean;
  brand_page_template: string;
  brand_page_content: unknown;
  brand_logo_url: string | null;
  public_booking_enabled: boolean;
  public_registration_enabled: boolean;
  events_enabled: boolean;
  memberships_enabled: boolean;
}

function scopedPath(path: string, clinic: ClinicRow, clinicId: string): string {
  const params = new URLSearchParams();
  if (clinic.slug) params.set("clinic_slug", clinic.slug);
  else params.set("clinic_id", clinicId);
  return `${path}?${params.toString()}`;
}

function lineUrl(lineBasicId: string | null): string | null {
  const id = lineBasicId?.trim();
  return id ? `https://line.me/R/ti/p/${encodeURIComponent(id)}` : null;
}

function phoneUrl(phone: string | null): string | null {
  const normalized = phone?.replace(/[^+\d]/g, "") ?? "";
  return normalized ? `tel:${normalized}` : null;
}

function activeEvents(rows: Array<Record<string, unknown>>): BrandPageEvent[] {
  const now = Date.now();
  return rows
    .filter((row) => {
      const opensAt = typeof row.registration_open_at === "string" ? Date.parse(row.registration_open_at) : null;
      const closesAt = typeof row.registration_close_at === "string" ? Date.parse(row.registration_close_at) : null;
      return (opensAt === null || opensAt <= now) && (closesAt === null || closesAt > now);
    })
    .slice(0, 3)
    .map((row) => {
      const sessions = Array.isArray(row.event_sessions)
        ? row.event_sessions.filter((session): session is Record<string, unknown> => Boolean(session) && typeof session === "object")
        : [];
      const nextSession = sessions
        .filter((session) => session.active === true && typeof session.start_at === "string" && Date.parse(session.start_at) > now)
        .sort((a, b) => Date.parse(String(a.start_at)) - Date.parse(String(b.start_at)))[0] ?? null;
      return {
      id: String(row.id),
      slug: String(row.slug),
      title: String(row.title),
      description: typeof row.description === "string" ? row.description : null,
      coverUrl: typeof row.cover_url === "string" ? row.cover_url : null,
      registrationCloseAt: typeof row.registration_close_at === "string" ? row.registration_close_at : null,
      nextSessionName: nextSession && typeof nextSession.name === "string" ? nextSession.name : null,
      nextSessionAt: nextSession && typeof nextSession.start_at === "string" ? nextSession.start_at : null,
      nextSessionCapacity: nextSession && typeof nextSession.capacity === "number" ? nextSession.capacity : null,
    };
    });
}

export async function loadPublicBrandPage(supabase: SupabaseClient, clinicId: string): Promise<PublicBrandPageData | null> {
  const [{ data: clinicData, error: clinicError }, { data: settingsData, error: settingsError }] = await Promise.all([
    supabase.from("clinics").select("name, slug, line_basic_id, phone, address, intro").eq("id", clinicId).eq("active", true).maybeSingle(),
    supabase.from("clinic_settings").select("brand_page_enabled, brand_page_template, brand_page_content, brand_logo_url, public_booking_enabled, public_registration_enabled, events_enabled, memberships_enabled").eq("clinic_id", clinicId).maybeSingle(),
  ]);
  if (clinicError || settingsError || !clinicData || !settingsData) return null;

  const clinic = clinicData as ClinicRow;
  const settings = settingsData as BrandPageSettingsRow;
  if (!settings.brand_page_enabled || !isBrandPageTemplate(settings.brand_page_template)) return null;

  const [servicesResult, eventsResult] = await Promise.all([
    settings.public_booking_enabled
      ? supabase.from("services").select("id, name, description").eq("clinic_id", clinicId).eq("active", true).order("created_at").limit(4)
      : Promise.resolve({ data: [], error: null }),
    settings.events_enabled && settings.public_registration_enabled
      ? supabase.from("events").select("id, slug, title, description, cover_url, registration_open_at, registration_close_at, event_sessions(name, start_at, capacity, active)").eq("clinic_id", clinicId).eq("status", "published").eq("access_mode", "public").order("registration_open_at", { ascending: true, nullsFirst: false }).limit(12)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (servicesResult.error || eventsResult.error) return null;

  const services: BrandPageService[] = (servicesResult.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: typeof row.description === "string" ? row.description : null,
  }));
  const events = activeEvents((eventsResult.data ?? []) as Array<Record<string, unknown>>);
  const content = normalizeBrandPageContent(settings.brand_page_content, settings.brand_page_template);
  const booking = settings.public_booking_enabled ? scopedPath("/book/browser", clinic, clinicId) : null;
  const registration = settings.events_enabled && settings.public_registration_enabled ? scopedPath("/register", clinic, clinicId) : null;
  const membership = settings.memberships_enabled ? scopedPath("/membership", clinic, clinicId) : null;
  const records = scopedPath("/my", clinic, clinicId);
  const learning = settings.brand_page_template === "education" && settings.events_enabled
    ? scopedPath("/learn", clinic, clinicId)
    : null;
  const preferred = brandPagePreferredEntry(content, settings.brand_page_template);
  const primary = preferred === "registration"
    ? registration ?? booking ?? lineUrl(clinic.line_basic_id) ?? phoneUrl(clinic.phone) ?? records
    : booking ?? registration ?? lineUrl(clinic.line_basic_id) ?? phoneUrl(clinic.phone) ?? records;
  const links: BrandPageLinks = {
    booking,
    registration,
    membership,
    records,
    learning,
    line: lineUrl(clinic.line_basic_id),
    phone: phoneUrl(clinic.phone),
    primary,
    secondary: "#brand-page-content",
  };

  return {
    template: settings.brand_page_template,
    name: clinic.name,
    slug: clinic.slug,
    logoUrl: settings.brand_logo_url,
    phone: clinic.phone,
    address: clinic.address,
    intro: clinic.intro,
    content,
    services,
    events,
    links,
  };
}
