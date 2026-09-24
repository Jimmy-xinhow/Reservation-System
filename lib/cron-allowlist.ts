import "server-only";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An allowlist is an execution boundary, not a hint to the runner. */
export function cronAllowedClinics(): Set<string> | null {
  const raw = process.env.CRON_ALLOWED_CLINIC_IDS;
  if (raw === undefined) return null;
  const ids = raw.split(",").map((id) => id.trim().toLowerCase());
  if (!ids.length || ids.some((id) => !uuid.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("invalid CRON_ALLOWED_CLINIC_IDS");
  }
  return new Set(ids);
}

export function cronScopeDenied(clinicId?: string): Response | null {
  try {
    const allowed = cronAllowedClinics();
    if (!allowed) return null;
    if (!clinicId || !allowed.has(clinicId.toLowerCase())) {
      return Response.json({ ok: false, error: "排程品牌不在授權範圍" }, { status: 403 });
    }
    return null;
  } catch {
    return Response.json({ ok: false, error: "排程品牌白名單設定錯誤" }, { status: 503 });
  }
}
