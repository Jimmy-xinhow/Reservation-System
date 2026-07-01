import { NextRequest } from "next/server";
import { icsContent } from "@/lib/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/ics?start=ISO&end=ISO&title=&details=&location=
 * 回傳 .ics 檔(含看診前 2 小時提醒),供病患加入手機行事曆。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const startIso = sp.get("start") ?? "";
  const endIso = sp.get("end") ?? startIso;
  const title = sp.get("title") ?? "看診預約";
  if (!startIso) return new Response("missing start", { status: 400 });

  const ics = icsContent({
    title,
    startIso,
    endIso,
    details: sp.get("details") ?? undefined,
    location: sp.get("location") ?? undefined,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="booking.ics"',
    },
  });
}
