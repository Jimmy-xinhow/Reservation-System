"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 每 N 秒重新整理(Server Component 資料)。 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
