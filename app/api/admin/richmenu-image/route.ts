import { requireMember } from "@/lib/admin";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { getRichMenuImage } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/richmenu-image — 回傳目前已發布 rich menu 的圖片(後台預覽)。 */
export async function GET() {
  try {
    await requireMember();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const svc = createServiceClient();
  const { data } = await svc
    .from("line_richmenu")
    .select("published_id")
    .eq("clinic_id", CLINIC_ID)
    .maybeSingle();
  const id = data?.published_id as string | null;
  if (!id) return new Response("no menu", { status: 404 });

  const img = await getRichMenuImage(id);
  if (!img) return new Response("no image", { status: 404 });
  return new Response(img.bytes, {
    headers: { "Content-Type": img.contentType, "Cache-Control": "no-store" },
  });
}
