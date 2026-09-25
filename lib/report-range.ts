/** Shared Taipei calendar range for the report page and its CSV. */
export function reportRange(from?: string | null, to?: string | null, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);
  const valid = (value?: string | null): value is string => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const fallback = new Date(`${today}T00:00:00Z`);
  fallback.setUTCDate(fallback.getUTCDate() - 29);
  const first = valid(from) ? from : fallback.toISOString().slice(0, 10);
  const last = valid(to) ? to : today;
  const startDate = first <= last ? first : last;
  const endDate = first <= last ? last : first;
  return { startDate, endDate, start: new Date(`${startDate}T00:00:00+08:00`).toISOString(), end: new Date(`${endDate}T23:59:59.999+08:00`).toISOString() };
}
