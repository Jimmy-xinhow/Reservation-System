// 時間格式化工具。基準時區一律 Asia/Taipei。

const TZ = "Asia/Taipei";
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function parts(iso: string): Record<string, string> {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** 台北時區的星期幾(0=日..6=六)。 */
export function taipeiWeekday(iso: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(
    new Date(iso),
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

/** 「上午」/「下午」。 */
export function amPm(iso: string): "上午" | "下午" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso)),
  );
  return hour < 12 ? "上午" : "下午";
}

/** 例:2026/06/30(週二) 14:30。 */
export function formatDateTime(iso: string): string {
  const p = parts(iso);
  const wd = WEEKDAYS[taipeiWeekday(iso)];
  return `${p.year}/${p.month}/${p.day}(週${wd}) ${p.hour}:${p.minute}`;
}

/** 例:2026/06/30(週二) 下午。 */
export function formatDateSession(iso: string): string {
  const p = parts(iso);
  const wd = WEEKDAYS[taipeiWeekday(iso)];
  return `${p.year}/${p.month}/${p.day}(週${wd}) ${amPm(iso)}`;
}

/** 例:14:30。 */
export function formatTime(iso: string): string {
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
}

/** 台北時區的 YYYY-MM-DD(送 RPC 的 p_date 用)。 */
export function taipeiDateString(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}
