const LIFF_STATE_KEY = "liff.state";

/**
 * LINE 的第一次 LIFF 導向會暫時把永久連結的 path/query 放在
 * `liff.state`，直到 liff.init() 完成才還原。品牌只用於選擇公開租戶，
 * 真正的顧客身分仍必須由該品牌的 LINE Login Channel 驗證 ID token。
 */
export function liffEntryParams(search: string): URLSearchParams {
  const direct = new URLSearchParams(search);
  const rawState = direct.get(LIFF_STATE_KEY)?.trim();
  if (!rawState) return direct;

  try {
    const stateUrl = new URL(rawState, "https://liff-entry.invalid/");
    for (const [key, value] of stateUrl.searchParams) {
      if (!direct.has(key)) direct.set(key, value);
    }
  } catch {
    // 無法解析的 liff.state 交由 LIFF SDK 處理；不可改寫或刪除它。
  }
  return direct;
}

export function liffEntryParam(search: string, key: string): string | null {
  const value = liffEntryParams(search).get(key)?.trim();
  return value || null;
}

/** A deep link selects a day only; current availability is always fetched again. */
export function bookingEntryDate(source: URLSearchParams, today: string, maxDate: string): string | null {
  const value = source.get("date")?.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today || value > maxDate) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}
