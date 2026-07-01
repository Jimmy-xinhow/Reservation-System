// 產生「加入行事曆」用的連結(零成本提醒:靠病患手機行事曆自動通知)。

function toUtcStamp(iso: string): string {
  // → 20260701T053000Z
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface CalEvent {
  title: string;
  startIso: string;
  endIso: string;
  details?: string;
  location?: string;
}

/** Google 日曆「新增活動」連結(手機/桌機瀏覽器皆可)。 */
export function googleCalendarUrl(e: CalEvent): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${toUtcStamp(e.startIso)}/${toUtcStamp(e.endIso)}`,
    details: e.details ?? "",
    location: e.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** .ics 檔內容(iOS/Outlook 相容);前端做成 data URL 下載。 */
export function icsContent(e: CalEvent): string {
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//clinic//booking//ZH",
    "BEGIN:VEVENT",
    `UID:${toUtcStamp(e.startIso)}-${Math.abs(hash(e.title))}@clinic`,
    `DTSTART:${toUtcStamp(e.startIso)}`,
    `DTEND:${toUtcStamp(e.endIso)}`,
    `SUMMARY:${esc(e.title)}`,
    e.details ? `DESCRIPTION:${esc(e.details)}` : "",
    e.location ? `LOCATION:${esc(e.location)}` : "",
    // 看診前 2 小時提醒(由病患裝置觸發,零成本)
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:看診提醒",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
