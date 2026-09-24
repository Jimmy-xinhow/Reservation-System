import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { createServiceClient } from "./supabase";
import { errorCategory } from "./error-category";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_LOCAL_BUCKETS = 2_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  unavailable?: boolean;
}

/**
 * Shared PostgreSQL limiter with a bounded local rejection cache.
 * The local layer also absorbs bursts before they reach the database.
 */
export async function checkRateLimit(
  req: NextRequest,
  key: string,
  limit = 30,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const localResult = checkLocalRateLimit(req, key, limit, windowMs);
  if (!localResult.allowed) return localResult;

  try {
    const svc = createServiceClient();
    const { data, error } = await svc.rpc("consume_api_rate_limit", {
      p_bucket_key: rateLimitBucketKey(req, key),
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    if (!isSharedRateLimitRow(row)) throw new Error("consume_api_rate_limit 回傳格式錯誤");
    return {
      allowed: row.allowed,
      retryAfterSeconds: Math.max(0, row.retry_after_seconds),
    };
  } catch (error) {
    console.error("[rate-limit] shared store unavailable; rejecting request", {
      key,
      category: errorCategory(error instanceof Error ? error.message : ""),
    });
    return { allowed: false, retryAfterSeconds: 5, unavailable: true };
  }
}

function checkLocalRateLimit(
  req: NextRequest,
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const address = rateLimitAddress(req);
  const bucketKey = `${key}:${address}`;
  const now = Date.now();
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    if (buckets.size >= MAX_LOCAL_BUCKETS) {
      for (const [existingKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(existingKey);
      }
      if (buckets.size >= MAX_LOCAL_BUCKETS) {
        const oldestKey = buckets.keys().next().value as string | undefined;
        if (oldestKey) buckets.delete(oldestKey);
      }
    }
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  if (current.count <= limit) return { allowed: true, retryAfterSeconds: 0 };

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

function rateLimitBucketKey(req: NextRequest, key: string): string {
  const address = rateLimitAddress(req);
  return createHash("sha256").update(`${key}:${address}`).digest("hex");
}

function rateLimitAddress(req: NextRequest): string {
  // Railway Edge supplies X-Real-IP as the remote address. Do not use the
  // client-controlled X-Forwarded-For chain to choose a rate-limit bucket.
  const address = req.headers.get("x-real-ip")?.trim() ?? "";
  return isIP(address) ? address : "unknown";
}

function isSharedRateLimitRow(value: unknown): value is { allowed: boolean; retry_after_seconds: number } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.allowed === "boolean" && typeof row.retry_after_seconds === "number"
    && Number.isInteger(row.retry_after_seconds) && row.retry_after_seconds >= 0
    && row.retry_after_seconds <= 86400
    && (row.allowed ? row.retry_after_seconds === 0 : row.retry_after_seconds >= 1);
}
