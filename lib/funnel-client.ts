export type FunnelEventName =
  | "portal_view"
  | "booking_view"
  | "booking_start"
  | "booking_success"
  | "registration_view"
  | "registration_start"
  | "registration_success"
  | "membership_view"
  | "membership_lookup"
  | "membership_purchase_start";

export function trackFunnelEvent(eventName: FunnelEventName, metadata: Record<string, string | number | boolean> = {}): void {
  if (typeof window === "undefined") return;
  try {
    const storageKey = "funnel_anonymous_id";
    const stored = window.sessionStorage.getItem(storageKey);
    const anonymousId = stored || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!stored) window.sessionStorage.setItem(storageKey, anonymousId);
    const source = new URLSearchParams(window.location.search);
    const scope = new URLSearchParams();
    const clinicSlug = source.get("clinic_slug")?.trim();
    const clinicId = source.get("clinic_id")?.trim();
    if (clinicSlug) scope.set("clinic_slug", clinicSlug);
    else if (clinicId) scope.set("clinic_id", clinicId);
    void fetch(`/api/analytics/funnel${scope.toString() ? `?${scope.toString()}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: eventName, anonymous_id: anonymousId, source: source.get("utm_source")?.slice(0, 80) || null, metadata }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never interrupt the customer journey.
  }
}
