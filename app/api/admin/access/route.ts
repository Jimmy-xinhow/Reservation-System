import { NextResponse } from "next/server";
import { getOptionalMember } from "@/lib/admin";
import { getOptionalPlatformAdmin } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const entry = new URL(request.url).searchParams.get("entry");
  if (entry !== "brand" && entry !== "platform") {
    return NextResponse.json({ error: "後台入口參數錯誤" }, { status: 400 });
  }

  try {
    const allowed = entry === "brand"
      ? Boolean(await getOptionalMember())
      : Boolean(await getOptionalPlatformAdmin());
    return NextResponse.json({ allowed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin access verification failed", error);
    return NextResponse.json({ error: "無法確認後台權限" }, { status: 500 });
  }
}
