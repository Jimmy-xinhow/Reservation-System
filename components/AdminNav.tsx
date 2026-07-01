"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin/dashboard", label: "總覽" },
  { href: "/admin", label: "今日約診" },
  { href: "/admin/queue", label: "叫號" },
  { href: "/admin/schedules", label: "門診表" },
  { href: "/admin/exceptions", label: "休診/加診" },
  { href: "/admin/services", label: "看診服務" },
  { href: "/admin/patients", label: "病患查詢" },
  { href: "/admin/settings", label: "診所設定" },
  { href: "/admin/line", label: "LINE 連線" },
  { href: "/admin/replies", label: "LINE 回覆" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {NAV.map((n) => {
        const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
