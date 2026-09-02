import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { renderRichMenuPng } from "@/lib/richmenu-art";
import { richMenuTemplate, type RichMenuModuleAvailability, type RichMenuTemplateKey } from "@/lib/richmenu";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let clinicId: string;
  try {
    ({ clinicId } = await requireAdmin());
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const rawTemplate = request.nextUrl.searchParams.get("template")?.trim() ?? "mixed";
  if (!(rawTemplate === "booking" || rawTemplate === "events" || rawTemplate === "mixed")) {
    return new Response("unsupported template", { status: 400 });
  }
  const service = createServiceClient();
  const { data: settings, error } = await service
    .from("clinic_settings")
    .select("public_booking_enabled, events_enabled, public_registration_enabled, memberships_enabled, line_channel_enabled, legacy_progress_enabled")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error || !settings) return new Response("settings unavailable", { status: 500 });
  const availability: RichMenuModuleAvailability = {
    booking: settings.public_booking_enabled === true,
    events: settings.events_enabled === true && settings.public_registration_enabled === true,
    tickets: settings.events_enabled === true,
    memberships: settings.memberships_enabled === true,
    line: settings.line_channel_enabled === true,
    legacyProgress: settings.legacy_progress_enabled === true,
  };
  const template = richMenuTemplate(rawTemplate as Exclude<RichMenuTemplateKey, "custom">, availability);
  const bytes = await renderRichMenuPng(template.layout, template.slots);
  const download = request.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      ...(download ? { "Content-Disposition": `attachment; filename="richmenu-${rawTemplate}.png"` } : {}),
    },
  });
}
