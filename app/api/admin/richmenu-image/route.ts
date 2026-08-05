import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { getRichMenuImage, lineAccessTokenForDestination } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/richmenu-image — 回傳目前已發布 rich menu 的圖片(後台預覽)。 */
export async function GET() {
  let clinicId: string;
  try {
    ({ clinicId } = await requireAdmin());
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const svc = createServiceClient();
  const [{ data }, { data: clinic, error: clinicError }] = await Promise.all([
    svc
      .from("line_richmenu")
      .select("published_id")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    svc.from("clinics").select("line_destination").eq("id", clinicId).maybeSingle(),
  ]);
  if (clinicError) return new Response("brand lookup failed", { status: 500 });
  const id = data?.published_id as string | null;
  if (!id) return new Response("no menu", { status: 404 });

  let img: Awaited<ReturnType<typeof getRichMenuImage>>;
  try {
    const token = lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
    img = await getRichMenuImage(id, token);
  } catch {
    return new Response("LINE is not configured", { status: 503 });
  }
  if (!img) return new Response("no image", { status: 404 });
  return new Response(img.bytes, {
    headers: { "Content-Type": img.contentType, "Cache-Control": "no-store" },
  });
}
