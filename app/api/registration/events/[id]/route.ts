import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitResponse(req, "registration:event-detail", 30);
  if (limited) return limited;
  try {
    const { id } = await context.params;
    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("尚未設定公開品牌", 500);
    const { data: settings, error: settingsError } = await svc.from("clinic_settings").select("events_enabled, public_registration_enabled").eq("clinic_id", clinicId).maybeSingle();
    if (settingsError) return fail(settingsError.message, 500);
    if (!settings) return fail("公開報名設定尚未完成", 503);
    if (settings.events_enabled !== true || settings.public_registration_enabled === false) return ok({ event: null });
    const accessToken = req.nextUrl.searchParams.get("access_token")?.trim() ?? "";
    const accessTokenHash = accessToken ? createHash("sha256").update(accessToken).digest("hex") : "";
    const eventQuery = svc
      .from("events")
      .select("id, clinic_id, slug, title, description, cover_url, registration_open_at, registration_close_at, terms_version, terms_text")
      .eq("clinic_id", clinicId)
      .eq("status", "published")
      .eq("access_mode", "public")
      .eq(looksLikeUuid(id) ? "id" : "slug", id)
      .maybeSingle();
    const { data: publicEvent, error: publicEventError } = await eventQuery;
    if (publicEventError) return fail(publicEventError.message, 500);
    let event = publicEvent;
    if (!event && accessTokenHash) {
      const { data: privateEvent, error: privateEventError } = await svc
        .from("events")
        .select("id, clinic_id, slug, title, description, cover_url, registration_open_at, registration_close_at, terms_version, terms_text")
        .eq(looksLikeUuid(id) ? "id" : "slug", id)
        .eq("clinic_id", clinicId)
        .eq("status", "published")
        .eq("access_mode", "private")
        .eq("access_token_hash", accessTokenHash)
        .maybeSingle();
      if (privateEventError) return fail(privateEventError.message, 500);
      event = privateEvent;
    }
    if (!event) return fail("活動不存在或尚未公開", 404);

    const [{ data: clinic, error: clinicError }, { data: sessions, error: sessionsError }, { data: ticketTypes, error: ticketsError }, { data: form, error: formError }] =
      await Promise.all([
        svc.from("clinics").select("name").eq("id", event.clinic_id).maybeSingle(),
        svc.from("event_sessions").select("id, name, start_at, end_at, venue, capacity, waitlist_enabled").eq("event_id", event.id).eq("clinic_id", event.clinic_id).eq("active", true).order("start_at"),
        svc.from("event_ticket_types").select("id, name, price, capacity, sale_start_at, sale_end_at").eq("event_id", event.id).eq("clinic_id", event.clinic_id).eq("active", true).order("price"),
        svc.from("registration_forms").select("id, version").eq("event_id", event.id).eq("clinic_id", event.clinic_id).eq("status", "published").order("version", { ascending: false }).limit(1).maybeSingle(),
      ]);
    if (clinicError || sessionsError || ticketsError || formError) {
      return fail(clinicError?.message ?? sessionsError?.message ?? ticketsError?.message ?? formError?.message ?? "活動資料讀取失敗", 500);
    }
    const { data: fields, error: fieldsError } = form
      ? await svc.from("registration_form_fields").select("id, field_key, label, field_type, required, options, sort_order").eq("form_id", form.id).eq("clinic_id", event.clinic_id).order("sort_order")
      : { data: [], error: null };
    if (fieldsError) return fail(fieldsError.message, 500);
    const now = Date.now();
    const visibleTickets = (ticketTypes ?? []).filter((ticket) => (!ticket.sale_start_at || new Date(ticket.sale_start_at).getTime() <= now) && (!ticket.sale_end_at || new Date(ticket.sale_end_at).getTime() > now));
    return ok({
      event: {
        ...event,
        clinic_name: clinic?.name ?? "",
        sessions: sessions ?? [],
        ticket_types: visibleTickets,
        form: form ?? null,
        fields: (fields ?? []).map((field) => ({ ...field, options: Array.isArray(field.options) ? field.options : [] })),
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "讀取活動失敗", 500);
  }
}
