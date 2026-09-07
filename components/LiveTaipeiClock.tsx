"use client";

import { useEffect, useState } from "react";

const formatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function LiveTaipeiClock({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time className={compact ? "live-taipei-clock is-compact" : "live-taipei-clock"} dateTime={now?.toISOString()} aria-label="目前台北時間">
      {now ? formatter.format(now) : "台北時間載入中"}
    </time>
  );
}
