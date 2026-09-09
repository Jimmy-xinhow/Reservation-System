import "server-only";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function configuredOrigins(): Array<string | undefined> {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return [
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    railwayDomain ? (/^https?:\/\//i.test(railwayDomain) ? railwayDomain : `https://${railwayDomain}`) : undefined,
  ];
}

function safeOrigin(value: string | undefined, production: boolean): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (production && LOOPBACK_HOSTS.has(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * 取得顧客可實際開啟的公開來源。Railway 的 request.url 可能是
 * localhost:8080，因此 production 只能使用明確設定或 Railway 公開網域。
 */
export function publicRequestOrigin(requestOrigin?: string): string {
  const production = process.env.NODE_ENV === "production";
  for (const configured of configuredOrigins()) {
    const origin = safeOrigin(configured, production);
    if (origin) return origin;
  }
  const fallback = safeOrigin(requestOrigin, production);
  if (fallback) return fallback;
  if (production) throw new Error("正式環境缺少可用的公開 APP_URL");
  return "http://localhost:3000";
}
