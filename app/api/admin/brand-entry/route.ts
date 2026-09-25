import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { deliveryError } from "@/lib/delivery-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const brand = new URL(request.url).searchParams.get("brand") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brand)) {
    return NextResponse.json({ error: "品牌入口無效" }, { status: 400 });
  }
  try {
    const { data, error } = await createServiceClient().from("clinics")
      .select("id, name")
      .eq("id", brand)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "找不到啟用中的品牌" }, { status: 404 });
    return NextResponse.json({ id: data.id, name: data.name }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("brand entry lookup failed", { category: deliveryError(error) });
    return NextResponse.json({ error: "目前無法確認品牌入口" }, { status: 503 });
  }
}
