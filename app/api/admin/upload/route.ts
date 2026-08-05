import { NextRequest } from "next/server";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "line-media";

/**
 * POST /api/admin/upload  (multipart, field: file)
 * 後台上傳圖片到 Supabase Storage,回傳公開 URL。需登入且屬本診所。
 */
export async function POST(req: NextRequest) {
  let clinicId = "";
  try {
    // 上傳路徑帶品牌鍵，避免不同品牌共用不可追蹤的平面檔名。
    ({ clinicId } = await requireOperator());
  } catch {
    return Response.json({ ok: false, error: "未授權" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ ok: false, error: "請選擇圖片" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ ok: false, error: "圖片需小於 5MB" }, { status: 400 });
  }
  const type = file.type;
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(type)) {
    return Response.json({ ok: false, error: "僅支援 PNG/JPG/GIF/WebP" }, { status: 400 });
  }

  const ext = type.split("/")[1].replace("jpeg", "jpg");
  if (!clinicId) return Response.json({ ok: false, error: "未授權" }, { status: 401 });
  const name = `${clinicId}/${Math.random().toString(36).slice(2)}${Date.now().toString(36)}.${ext}`;

  const svc = createServiceClient();
  const { error } = await svc.storage
    .from(BUCKET)
    .upload(name, await file.arrayBuffer(), { contentType: type, upsert: false });
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  const { data } = svc.storage.from(BUCKET).getPublicUrl(name);
  return Response.json({ ok: true, url: data.publicUrl });
}
