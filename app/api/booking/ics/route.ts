import { NextRequest } from "next/server";
import { icsContent } from "@/lib/calendar";
import { rateLimitResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/ics?start=ISO&end=ISO&title=&details=&location=
 * 回傳 .ics 檔(含看診前 2 小時提醒),供病患加入手機行事曆。
 */
export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, "booking:ics", 30);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const startIso = sp.get("start") ?? "";
  const endIso = sp.get("end") ?? startIso;
  const title = (sp.get("title") ?? "看診預約").slice(0, 200);
  const details = sp.get("details")?.slice(0, 2000) ?? undefined;
  const location = sp.get("location")?.slice(0, 500) ?? undefined;
  if (!startIso) return new Response("missing start", { status: 400 });

  let ics: string;
  try {
    ics = icsContent({ title, startIso, endIso, details, location });
  } catch {
    return new Response("invalid calendar range", { status: 400 });
  }

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="booking.ics"',
    },
  });
}
