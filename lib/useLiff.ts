"use client";

import { useEffect, useState } from "react";

interface LiffSdk {
  init: (config: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: () => void;
  getIDToken: () => string | null;
  isInClient?: () => boolean;
  isApiAvailable?: (apiName: "createShortcutOnHomeScreen") => boolean;
  createShortcutOnHomeScreen?: (params: { url: string }) => Promise<void>;
  closeWindow?: () => void;
  openWindow?: (config: { url: string; external?: boolean }) => void;
}

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

const SDK_SRC = "https://static.line-scdn.net/liff/edge/2/sdk.js";

function loadSdk(): Promise<LiffSdk> {
  return new Promise((resolve, reject) => {
    if (window.liff) return resolve(window.liff);
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.onload = () => (window.liff ? resolve(window.liff) : reject(new Error("LIFF SDK 載入失敗")));
    s.onerror = () => reject(new Error("LIFF SDK 載入失敗"));
    document.head.appendChild(s);
  });
}

export interface LiffState {
  ready: boolean;
  idToken: string | null;
  error: string | null;
  isInClient: boolean;
  canCreateHomeShortcut: boolean;
}

/**
 * 載入並初始化指定品牌的 LIFF。undefined 代表品牌設定仍在載入；null
 * 代表該品牌沒有可用的 LIFF，避免先用全域 ID 初始化到錯誤渠道。
 */
export function useLiff(liffId: string | null | undefined): LiffState {
  const [state, setState] = useState<LiffState>({ ready: false, idToken: null, error: null, isInClient: false, canCreateHomeShortcut: false });

  useEffect(() => {
    if (liffId === undefined) return;
    if (!liffId) {
      setState({ ready: false, idToken: null, error: "此品牌尚未完成 LIFF 設定", isInClient: false, canCreateHomeShortcut: false });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const liff = await loadSdk();
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          liff.login();
          return; // 導向登入後會重新載入頁面
        }
        const token = liff.getIDToken();
        if (cancelled) return;
        if (!token) {
          setState({ ready: false, idToken: null, error: "無法取得 LINE 身分,請重新開啟", isInClient: liff.isInClient?.() === true, canCreateHomeShortcut: false });
          return;
        }
        setState({
          ready: true,
          idToken: token,
          error: null,
          isInClient: liff.isInClient?.() === true,
          canCreateHomeShortcut: liff.isApiAvailable?.("createShortcutOnHomeScreen") === true && typeof liff.createShortcutOnHomeScreen === "function",
        });
      } catch (e) {
        if (!cancelled) {
          setState({ ready: false, idToken: null, error: e instanceof Error ? e.message : "LIFF 初始化失敗", isInClient: false, canCreateHomeShortcut: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  return state;
}

/**
 * 開啟 LINE MINI App 的「加入手機主畫面」流程。功能僅在 LINE 判定目前
 * 已驗證 MINI App 與裝置版本都支援時才可呼叫。
 */
export async function createLiffHomeShortcut(url: string): Promise<void> {
  const liff = typeof window === "undefined" ? undefined : window.liff;
  if (!liff?.createShortcutOnHomeScreen || liff.isApiAvailable?.("createShortcutOnHomeScreen") !== true) {
    throw new Error("此入口尚未通過 LINE MINI App 驗證，暫時無法加入手機桌面。");
  }
  await liff.createShortcutOnHomeScreen({ url });
}

/** 完成單一 LIFF 任務後回到 LINE；瀏覽器備援入口則回傳 false。 */
export function closeLiffWindow(): boolean {
  if (typeof window === "undefined" || window.liff?.isInClient?.() !== true || !window.liff.closeWindow) return false;
  window.liff.closeWindow();
  return true;
}
