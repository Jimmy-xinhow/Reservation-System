"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

interface Item {
  href: string;
  label: string;
  adminOnly?: boolean;
}
interface Group {
  label: string;
  items: Item[];
  adminOnly?: boolean;
}

const GROUPS: Group[] = [
  {
    label: "看診作業",
    items: [
      { href: "/admin/dashboard", label: "總覽" },
      { href: "/admin", label: "今日約診" },
      { href: "/admin/queue", label: "叫號" },
    ],
  },
  {
    label: "門診排程",
    items: [
      { href: "/admin/schedules", label: "門診表" },
      { href: "/admin/exceptions", label: "休診/加診" },
      { href: "/admin/services", label: "看診服務" },
    ],
  },
  {
    label: "病患",
    items: [{ href: "/admin/patients", label: "病患查詢" }],
  },
  {
    label: "LINE",
    adminOnly: true,
    items: [
      { href: "/admin/line", label: "LINE 連線" },
      { href: "/admin/replies", label: "LINE 回覆" },
      { href: "/admin/messages", label: "訊息素材" },
      { href: "/admin/richmenu", label: "圖文選單" },
    ],
  },
  {
    label: "系統設定",
    items: [
      { href: "/admin/settings", label: "診所設定" },
      { href: "/admin/users", label: "使用者管理", adminOnly: true },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminNav({ role }: { role: "admin" | "staff" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const isAdmin = role === "admin";

  // 非管理員:隱藏 adminOnly 群組與項目(僅 UI;真正權限由 server 端 requireAdmin 強制)
  const groups = GROUPS.filter((g) => isAdmin || !g.adminOnly)
    .map((g) => ({ ...g, items: g.items.filter((it) => isAdmin || !it.adminOnly) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {groups.map((g) => {
        // 單一項目 → 直接連結
        if (g.items.length === 1) {
          const it = g.items[0];
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={g.label}
              href={it.href}
              className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {it.label}
            </Link>
          );
        }
        const groupActive = g.items.some((it) => isActive(pathname, it.href));
        const isOpen = open === g.label;
        return (
          <div key={g.label} className="relative">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : g.label)}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                groupActive ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {g.label}
              <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}>
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>
            {isOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(null)} />
                <div className="absolute left-0 top-full z-20 mt-1 min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                  {g.items.map((it) => {
                    const active = isActive(pathname, it.href);
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        onClick={() => setOpen(null)}
                        className={`block rounded-lg px-3 py-2 ${
                          active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {it.label}
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}
