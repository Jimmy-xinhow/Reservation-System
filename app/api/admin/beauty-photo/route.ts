import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "customer-media";

function matchesImageSignature(data: Buffer, type: string): boolean {
  if (type === "image/png") return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (type === "image/webp") return data.subarray(0, 4).equals(Buffer.from("RIFF")) && data.subarray(8, 12).equals(Buffer.from("WEBP"));
  return false;
}

export async function POST(request: NextRequest) {
  let clinicId = "";
  try { ({ clinicId } = await requireOperator()); } catch { return Response.json({ ok: false, error: "未授權" }, { status: 401 }); }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const appointmentId = String(form?.get("appointment_id") ?? "").trim();
  if (!(file instanceof File) || !appointmentId) return Response.json({ ok: false, error: "請先選擇預約與照片" }, { status: 400 });
  if (file.size === 0 || file.size > 5 * 1024 * 1024) return Response.json({ ok: false, error: "照片需小於 5MB" }, { status: 400 });
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return Response.json({ ok: false, error: "僅支援 PNG、JPG、WebP" }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  if (!matchesImageSignature(data, file.type)) return Response.json({ ok: false, error: "檔案內容與圖片格式不符" }, { status: 400 });
  const service = createServiceClient();
  const { data: appointment } = await service.from("appointments").select("id").eq("id", appointmentId).eq("clinic_id", clinicId).maybeSingle();
  if (!appointment) return Response.json({ ok: false, error: "預約不屬於目前品牌" }, { status: 403 });
  const { data: bucket } = await service.storage.getBucket(BUCKET);
  if (!bucket) {
    const { error } = await service.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] });
    if (error && !error.message.toLowerCase().includes("already")) return Response.json({ ok: false, error: "私密照片空間建立失敗" }, { status: 500 });
  }
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${clinicId}/${appointmentId}/${randomBytes(16).toString("hex")}.${ext}`;
  const { error: uploadError } = await service.storage.from(BUCKET).upload(path, data, { contentType: file.type, upsert: false });
  if (uploadError) return Response.json({ ok: false, error: "照片上傳失敗" }, { status: 500 });
  const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(path, 3600);
  return Response.json({ ok: true, path, preview_url: signed?.signedUrl ?? null });
}
