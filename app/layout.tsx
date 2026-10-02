import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolvePublicClinicIdFromScope } from "@/lib/public-brand";
import { createServiceClient } from "@/lib/supabase";
import "@fontsource-variable/chiron-hei-hk";
import "@fontsource-variable/chiron-sung-hk";
import "./globals.css";

const platformMetadata: Metadata = {
  title: "XINHOW｜預約與報名平台 SaaS",
  description: "XINHOW 將預約、活動報名、標準金流、提醒、CRM Lite 與營運報表整合在同一個多品牌 SaaS 平台。",
  icons: { icon: "/brand/xinhao-black-light.png" },
};

function isSharedHost(host: string): boolean {
  if (!host || ["localhost", "127.0.0.1", "[::1]"].includes(host)) return true;
  if (host.endsWith(".up.railway.app") || host.endsWith(".vercel.app")) return true;
  const configured = [process.env.PUBLIC_PLATFORM_HOSTS, process.env.PUBLIC_SHARED_HOSTS, process.env.VERCEL_URL]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean);
  return configured.includes(host);
}

export async function generateMetadata(): Promise<Metadata> {
  const host = ((await headers()).get("host") ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (isSharedHost(host)) return platformMetadata;
  try {
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicIdFromScope(service, { host });
    if (!clinicId) return platformMetadata;
    const { data, error } = await service.from("clinics").select("name").eq("id", clinicId).eq("active", true).maybeSingle();
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    if (error || !name) return platformMetadata;
    return {
      title: `${name}｜線上預約與活動報名`,
      description: `${name} 的線上預約與活動報名服務。`,
      icons: platformMetadata.icons,
    };
  } catch {
    return platformMetadata;
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
