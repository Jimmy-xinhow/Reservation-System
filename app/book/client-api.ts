export async function bookingApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBookingBrandScope(url), init);
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!json) throw new Error("伺服器回應異常");
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function withBookingBrandScope(url: string): string {
  if (typeof window === "undefined" || !url.startsWith("/api/")) return url;
  const source = new URLSearchParams(window.location.search);
  const scope = new URLSearchParams();
  const clinicSlug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (clinicSlug) scope.set("clinic_slug", clinicSlug);
  else if (clinicId) scope.set("clinic_id", clinicId);
  if (!scope.toString()) return url;
  const target = new URL(url, window.location.origin);
  scope.forEach((value, key) => target.searchParams.set(key, value));
  return `${target.pathname}${target.search}`;
}
