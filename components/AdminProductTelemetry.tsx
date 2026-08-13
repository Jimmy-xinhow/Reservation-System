"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const SESSION_KEY = "xh_admin_product_session";

function sessionId(): string {
  let value = window.sessionStorage.getItem(SESSION_KEY);
  if (!value) {
    value = `aps_${crypto.randomUUID().replaceAll("-", "")}`;
    window.sessionStorage.setItem(SESSION_KEY, value);
  }
  return value;
}

function send(eventName: string, pathname: string, metadata: Record<string, string | number | boolean | null> = {}, beacon = false) {
  const body = JSON.stringify({ event_name: eventName, session_id: sessionId(), pathname, metadata });
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/admin/product-events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/admin/product-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function AdminProductTelemetry() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/admin/settings") return;
    let submitted = false;
    let closed = false;
    send("settings_view", pathname);
    const onSubmit = () => {
      submitted = true;
      send("settings_submit", pathname);
    };
    const onPageHide = () => {
      if (closed) return;
      closed = true;
      send("settings_exit", pathname, { submitted }, true);
    };
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pagehide", onPageHide);
      onPageHide();
    };
  }, [pathname]);
  return null;
}

export function PermissionHelpButton() {
  const pathname = usePathname();
  return (
    <button type="button" className="min-h-11 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 hover:bg-amber-100" onClick={() => send("permission_help_requested", pathname, { source: "permission_notice" })}>
      記錄權限求助
    </button>
  );
}
