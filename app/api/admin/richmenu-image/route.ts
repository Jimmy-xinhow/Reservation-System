import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { getRichMenuImage, lineAccessTokenForDestination } from "@/lib/line";
import { NextRequest } from "next/server";
import { getClinicLineChannelContext } from "@/lib/line-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/richmenu-image — 回傳目前已發布 rich menu 的圖片(後台預覽)。 */
export async function GET(request: NextRequest) {
  let clinicId: string;
  try {
    ({ clinicId } = await requireAdmin());
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const svc = createServiceClient();
  const versionId = request.nextUrl.searchParams.get("version")?.trim() || null;
  const [{ data }, { data: version, error: versionError }] = await Promise.all([
    svc
      .from("line_richmenu")
      .select("published_id")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    versionId
      ? svc.from("line_richmenu_versions").select("line_rich_menu_id").eq("id", versionId).eq("clinic_id", clinicId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (versionError) return new Response("version lookup failed", { status: 500 });
  const id = (version?.line_rich_menu_id as string | null) ?? (data?.published_id as string | null);
  if (!id) return new Response("no menu", { status: 404 });

  let img: Awaited<ReturnType<typeof getRichMenuImage>>;
  try {
    const context = await getClinicLineChannelContext(svc, clinicId);
    const token = lineAccessTokenForDestination(context.destination ?? undefined);
    img = await getRichMenuImage(id, token);
  } catch {
    return new Response("LINE is not configured", { status: 503 });
  }
  if (!img) return new Response("no image", { status: 404 });
  return new Response(img.bytes, {
    headers: { "Content-Type": img.contentType, "Cache-Control": "no-store" },
  });
}
