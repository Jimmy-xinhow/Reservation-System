"use client";

import { useEffect } from "react";

/**
 * Supabase 的邀請／重設密碼回呼若未指定 redirectTo，會回到 Site URL。
 * 將回呼參數原封不動帶到密碼設定頁，避免一次性 token 被根頁吃掉。
 */
export function AuthCallbackBridge() {
  useEffect(() => {
    const current = new URL(window.location.href);
    const queryType = current.searchParams.get("type");
    const hashParams = new URLSearchParams(current.hash.replace(/^#/, ""));
    const hashType = hashParams.get("type");
    const isAuthCallback = Boolean(
      current.searchParams.has("code") ||
      ["invite", "recovery"].includes(queryType ?? "") ||
      ["invite", "recovery"].includes(hashType ?? "") ||
      hashParams.has("access_token"),
    );

    if (!isAuthCallback) return;

    const target = new URL("/auth/accept-invite", current.origin);
    target.search = current.search;
    target.hash = current.hash;
    window.location.replace(target.toString());
  }, []);

  return null;
}
