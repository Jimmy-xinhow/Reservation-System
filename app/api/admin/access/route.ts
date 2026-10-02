import { deliveryError } from "@/lib/delivery-error";
import { NextResponse } from "next/server";
import { getOptionalMember } from "@/lib/admin";
import { getOptionalPlatformAdmin } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const entry = params.get("entry");
  const brand = params.get("brand");
  if (entry !== "brand" && entry !== "platform") {
    return NextResponse.json({ error: "後台入口參數錯誤" }, { status: 400 });
  }
  if (params.has("brand") && (entry !== "brand" || !brand || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brand))) {
    return NextResponse.json({ error: "品牌入口參數錯誤" }, { status: 400 });
  }

  try {
    const member = entry === "brand" ? await getOptionalMember() : null;
    const allowed = entry === "brand"
      ? Boolean(member && (!brand || member.clinics.some((clinic) => clinic.id === brand)))
      : Boolean(await getOptionalPlatformAdmin());
    return NextResponse.json({ allowed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin access verification failed", { category: deliveryError(error) });
    return NextResponse.json({ error: "無法確認後台權限" }, { status: 500 });
  }
}
