/** Browser storage is optional: third-party iframe and privacy modes may deny access. */
export function safeLocalStorageRemoveMatching(keys: readonly string[], expected: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (const key of keys) {
      // A different tab may already have replaced this session.
      if (window.localStorage.getItem(key) === expected) window.localStorage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageGet(...keys: string[]): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of keys) {
      const value = window.localStorage.getItem(key);
      if (value) return value;
    }
  } catch {
    return null;
  }
  return null;
}

export function safeLocalStorageSet(entries: ReadonlyArray<readonly [string, string]>): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
