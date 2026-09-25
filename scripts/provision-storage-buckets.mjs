import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const STORAGE_BUCKETS = [
  { id: "line-media", public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] },
  { id: "customer-media", public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] },
];

function isMissingBucket(error) {
  const code = String(error?.statusCode ?? error?.status ?? "");
  return code === "404" || /bucket not found|resource was not found/i.test(String(error?.message ?? ""));
}

export async function verifyStorageBuckets(storage, { apply = false } = {}) {
  const results = [];
  for (const definition of STORAGE_BUCKETS) {
    const initial = await storage.getBucket(definition.id);
    if (initial.error && !isMissingBucket(initial.error)) {
      throw new Error(`${definition.id}: 無法讀取 Storage bucket`);
    }
    if (initial.data) {
      if (initial.data.public !== definition.public) {
        throw new Error(`${definition.id}: 公開性設定與產品用途不符，請人工檢查`);
      }
      results.push({ id: definition.id, status: "ready", public: definition.public });
      continue;
    }
    if (!apply) {
      results.push({ id: definition.id, status: "missing", public: definition.public });
      continue;
    }
    const created = await storage.createBucket(definition.id, {
      public: definition.public,
      fileSizeLimit: definition.fileSizeLimit,
      allowedMimeTypes: definition.allowedMimeTypes,
    });
    // Another setup process may have created the bucket; verify its final state in either case.
    const final = await storage.getBucket(definition.id);
    if (final.error || !final.data || final.data.public !== definition.public) {
      throw new Error(`${definition.id}: 建立或驗證 Storage bucket 失敗${created.error ? "，請檢查專案權限" : ""}`);
    }
    results.push({ id: definition.id, status: "created", public: definition.public });
  }
  return results;
}

export function projectUrlFor(ref) {
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("請明確指定 Supabase project ref");
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = rawUrl ? new URL(rawUrl) : null;
  if (!url || url.protocol !== "https:" || url.hostname !== `${ref}.supabase.co` || url.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 與指定 project ref 不一致");
  }
  return url.origin;
}

async function main() {
  const args = process.argv.slice(2);
  const refArg = args.find((arg) => arg.startsWith("--project-ref="));
  const ref = refArg?.slice("--project-ref=".length) ?? "";
  if (args.some((arg) => arg !== refArg && arg !== "--apply")) throw new Error("只接受 --project-ref=<ref> 與可選的 --apply");
  const url = projectUrlFor(ref);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("缺少 server-only SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const results = await verifyStorageBuckets(client.storage, { apply: args.includes("--apply") });
  console.log(JSON.stringify({ projectRef: ref, applied: args.includes("--apply"), buckets: results }));
  if (results.some((result) => result.status === "missing")) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Storage bucket 檢查失敗");
    process.exitCode = 1;
  });
}
