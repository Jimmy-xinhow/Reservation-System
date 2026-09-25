export function registrationStoredRecord(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function registrationStoredToken(raw: string | null): string {
  const record = registrationStoredRecord(raw);
  return typeof record.checkin_token === "string" ? record.checkin_token.trim() : "";
}

export function registrationRecordWithToken(raw: string | null, token: string): string | null {
  if (!token.trim()) return null;
  return JSON.stringify({ ...registrationStoredRecord(raw), checkin_token: token.trim() });
}
