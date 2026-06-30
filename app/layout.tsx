import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "診所預約系統",
  description: "線上預約 · 提醒 · 後台管理",
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
