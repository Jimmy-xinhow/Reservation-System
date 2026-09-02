import type { Metadata } from "next";
import { ShowcaseFonts } from "@/components/showcase/ShowcaseFonts";

export const metadata: Metadata = {
  title: "產業形象頁設計審稿｜XINHOW",
  description: "八個產業的高保真品牌形象頁設計方向。",
  robots: { index: false, follow: false },
};

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ShowcaseFonts />
      {children}
    </>
  );
}
