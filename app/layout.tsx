import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XINHOW｜預約與報名平台 SaaS",
  description: "XINHOW 將預約、活動報名、標準金流、提醒、CRM Lite 與營運報表整合在同一個多品牌 SaaS 平台。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <head>
        {/* Noto Sans TC:中文字體升級,載入失敗則自動回退系統字體 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
