import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { lineBrandTheme } from "@/lib/line-ui-templates";
import { customerAppConfigFromContent, isBrandPageTemplate, normalizeBrandPageContent } from "@/lib/brand-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = await rateLimitResponse(request, "customer:entry-config", 30);
  if (limited) return limited;
  try {
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const [{ data: clinic, error: clinicError }, { data: settings, error: settingsError }, line] = await Promise.all([
      service.from("clinics").select("name, phone, address, intro, line_basic_id, slug").eq("id", clinicId).eq("active", true).maybeSingle(),
      service.from("clinic_settings").select("booking_mode, public_booking_enabled, public_registration_enabled, events_enabled, memberships_enabled, line_channel_enabled, brand_page_enabled, brand_page_template, brand_page_content, brand_logo_url, brand_primary_color, brand_accent_color").eq("clinic_id", clinicId).maybeSingle(),
      getClinicLineChannelContext(service, clinicId),
    ]);
    if (clinicError || settingsError) return fail(clinicError?.message ?? settingsError?.message ?? "入口設定載入失敗", 500);
    if (!clinic || !settings) return fail("品牌入口尚未完成設定", 503);
    const theme = lineBrandTheme(
      settings.brand_page_template,
      settings.brand_primary_color,
      settings.brand_accent_color,
    );
    const brandTemplate = isBrandPageTemplate(settings.brand_page_template) ? settings.brand_page_template : "beauty";
    const customerApp = customerAppConfigFromContent(normalizeBrandPageContent(settings.brand_page_content, brandTemplate));
    return ok({
      clinic_name: clinic.name,
      clinic_slug: clinic.slug,
      phone: clinic.phone,
      address: clinic.address,
      intro: clinic.intro,
      line_basic_id: clinic.line_basic_id,
      liff_id: line.enabled ? line.liffId : null,
      booking_mode: settings.booking_mode === "number" ? "number" : "time",
      brand_page_enabled: settings.brand_page_enabled === true,
      brand_logo_url: settings.brand_logo_url?.trim() || null,
      brand_primary_color: theme.primary,
      brand_accent_color: theme.accent,
      brand_soft_color: theme.soft,
      brand_ink_color: theme.ink,
      customer_app: customerApp,
      availability: {
        booking: settings.public_booking_enabled === true,
        events: settings.events_enabled === true && settings.public_registration_enabled === true,
        tickets: settings.events_enabled === true,
        memberships: settings.memberships_enabled === true,
        line: settings.line_channel_enabled === true && line.verificationStatus === "ready",
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "入口設定載入失敗", 500);
  }
}
