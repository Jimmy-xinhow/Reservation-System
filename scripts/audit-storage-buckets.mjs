import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { projectUrlFor } from "./provision-storage-buckets.mjs";

const refArg = process.argv.slice(2).find((arg) => arg.startsWith("--project-ref="));
const ref = refArg?.slice("--project-ref=".length) ?? "";
if (process.argv.slice(2).some((arg) => arg !== refArg)) throw new Error("只接受 --project-ref=<ref>");
const url = projectUrlFor(ref);
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("缺少 server-only SUPABASE_SERVICE_ROLE_KEY");

const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const path = `qa-storage/${randomUUID()}.png`;
const results = [];
const uploaded = [];

async function responseMatchesImage(target) {
  const response = await fetch(target, { cache: "no-store" });
  return response.ok && Buffer.from(await response.arrayBuffer()).equals(image);
}

try {
  for (const bucket of ["line-media", "customer-media"]) {
    const result = await storage.from(bucket).upload(path, image, { contentType: "image/png", upsert: false });
    if (result.error) throw new Error(`${bucket}: 合成圖片上傳失敗`);
    uploaded.push(bucket);
  }
  const publicUrl = storage.from("line-media").getPublicUrl(path).data.publicUrl;
  if (!await responseMatchesImage(publicUrl)) throw new Error("line-media: 公開圖片無法讀回");
  results.push("public_image_readable");

  const privateUrl = storage.from("customer-media").getPublicUrl(path).data.publicUrl;
  const privateResponse = await fetch(privateUrl, { cache: "no-store" });
  if (privateResponse.ok) throw new Error("customer-media: 私密圖片竟可由公開網址讀取");
  results.push("private_public_url_denied");

  const signed = await storage.from("customer-media").createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl || !await responseMatchesImage(signed.data.signedUrl)) {
    throw new Error("customer-media: 簽名連結無法讀取");
  }
  results.push("private_signed_url_readable");
} finally {
  for (const bucket of uploaded) {
    const removed = await storage.from(bucket).remove([path]);
    if (removed.error) results.push(`${bucket}_cleanup_failed`);
  }
}

if (results.some((result) => result.endsWith("cleanup_failed"))) throw new Error("合成圖片清理失敗");
console.log(JSON.stringify({ projectRef: ref, checks: results, cleanup: "removed" }));
