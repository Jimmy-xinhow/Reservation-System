// Persist only a hash and random request ID, never the submitted personal data.
const pending = new Map<string, string>();
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canonicalSubmission(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSubmission).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalSubmission(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function identityHint(body: Record<string, unknown>): unknown {
  if (typeof body.browser_token !== "string") return body.patient_id ?? null;
  try {
    const raw = body.browser_token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(raw));
    if (payload && typeof payload === "object" && "patientId" in payload && "clinicId" in payload) return payload;
  } catch { /* This is only a cache namespace; the API always verifies identity. */ }
  return body.browser_token;
}

export async function customerSubmissionFetch(url: string, init?: RequestInit): Promise<Response> {
  const target = new URL(url, window.location.origin);
  if (init?.method !== "POST" || typeof init.body !== "string" || !["/api/booking/reserve", "/api/registration/register"].includes(target.pathname)) return fetch(url, init);
  const body = JSON.parse(init.body) as Record<string, unknown>;
  const hint = identityHint(body);
  const identity = hint && typeof hint === "object" && "patientId" in hint && "clinicId" in hint ? { patientId: hint.patientId, clinicId: hint.clinicId } : hint;
  const normalized = { ...body, idToken: undefined, browser_token: undefined, request_id: undefined, identity };
  target.searchParams.sort();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(target.pathname + target.search + canonicalSubmission(normalized)));
  const key = `customer_submission:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("")}`;
  const acquire = () => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(key); } catch { /* In-memory retries still work without storage. */ }
    const id = stored && requestIdPattern.test(stored) ? stored : pending.get(key) ?? crypto.randomUUID();
    pending.set(key, id);
    try { window.localStorage.setItem(key, id); } catch { /* Storage can be disabled by the browser. */ }
    return id;
  };
  let id: string;
  try {
    id = typeof navigator !== "undefined" && navigator.locks ? await navigator.locks.request(key, acquire) : acquire();
  } catch {
    id = acquire(); // Some embedded browsers deny cross-tab locks along with storage access.
  }
  try {
    const response = await fetch(url, { ...init, body: JSON.stringify({ ...body, request_id: id }) });
    const result = await response.clone().json().catch(() => null) as { ok?: boolean; data?: unknown } | null;
    if (response.ok && result?.ok && result.data) {
      pending.delete(key);
      try { if (window.localStorage.getItem(key) === id) window.localStorage.removeItem(key); } catch { /* Success is not dependent on storage. */ }
    }
    return response;
  } catch {
    throw new TypeError("送出結果尚未確認；請保留相同內容重試，或先查看我的紀錄，避免改填後重複送出。");
  }
}
