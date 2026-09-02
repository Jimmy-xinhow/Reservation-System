import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XINHOW｜預約與報名平台 SaaS",
  description: "XINHOW 將預約、活動報名、標準金流、提醒、CRM Lite 與營運報表整合在同一個多品牌 SaaS 平台。",
  icons: { icon: "/brand/xinhao-black-light.png" },
};

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
