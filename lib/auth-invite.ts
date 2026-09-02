import "server-only";

const LOCAL_ORIGIN = "http://localhost:3000";

function configuredOrigin(): string | null {
  const configured = [
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN
      ? (/^https?:\/\//i.test(process.env.RAILWAY_PUBLIC_DOMAIN.trim())
        ? process.env.RAILWAY_PUBLIC_DOMAIN
        : `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
      : null,
  ];

  for (const value of configured) {
    const candidate = value?.trim();
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Try the next configured public URL; production must not fall back to localhost.
    }
  }

  return null;
}

/** Invite links must return to the deployed app, never to a provider default localhost URL. */
export function authInviteRedirectUrl(): string {
  const origin = configuredOrigin();
  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("部署環境缺少 APP_URL，無法建立可用的邀請連結。");
    }
    return `${LOCAL_ORIGIN}/auth/accept-invite`;
  }
  return `${origin}/auth/accept-invite`;
}
