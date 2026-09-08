import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { renderRichMenuPng } from "@/lib/richmenu-art";
import { isBuiltInRichMenuTemplate, richMenuTemplate, LAYOUTS, type Layout, type RichMenuModuleAvailability, type Slot } from "@/lib/richmenu";
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
  if (!isBuiltInRichMenuTemplate(rawTemplate)) {
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
  const template = richMenuTemplate(rawTemplate, availability);
  const bytes = await renderRichMenuPng(template.layout, template.slots, rawTemplate);
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

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const body = await request.json().catch(() => null) as { template?: string; layout?: string; slots?: Slot[] } | null;
  const template = body?.template?.trim() ?? "";
  const layout = body?.layout?.trim() as Layout | undefined;
  if (!isBuiltInRichMenuTemplate(template) || !layout || !LAYOUTS[layout] || !Array.isArray(body?.slots) || body.slots.length !== LAYOUTS[layout].slots) {
    return new Response("invalid artwork request", { status: 400 });
  }
  const bytes = await renderRichMenuPng(layout, body.slots, template);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Content-Length": String(bytes.byteLength), "Cache-Control": "no-store" } });
}
