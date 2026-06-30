import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "慈愛中醫診所 · 線上預約",
  description: "慈愛中醫診所線上預約系統 · 預約 · 提醒 · 後台管理",
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
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
