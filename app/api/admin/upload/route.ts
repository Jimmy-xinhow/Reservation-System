import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "line-media";

function matchesImageSignature(data: Buffer, type: string): boolean {
  if (type === "image/png") return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (type === "image/gif") return data.subarray(0, 6).equals(Buffer.from("GIF87a")) || data.subarray(0, 6).equals(Buffer.from("GIF89a"));
  if (type === "image/webp") return data.subarray(0, 4).equals(Buffer.from("RIFF")) && data.subarray(8, 12).equals(Buffer.from("WEBP"));
  return false;
}

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
  const fileData = Buffer.from(await file.arrayBuffer());
  if (!matchesImageSignature(fileData, type)) {
    return Response.json({ ok: false, error: "檔案內容與圖片格式不符" }, { status: 400 });
  }

  const ext = type.split("/")[1].replace("jpeg", "jpg");
  if (!clinicId) return Response.json({ ok: false, error: "未授權" }, { status: 401 });
  const name = `${clinicId}/${randomBytes(16).toString("hex")}.${ext}`;

  const svc = createServiceClient();
  const { error } = await svc.storage
    .from(BUCKET)
    .upload(name, fileData, { contentType: type, upsert: false });
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  const { data } = svc.storage.from(BUCKET).getPublicUrl(name);
  return Response.json({ ok: true, url: data.publicUrl });
}
