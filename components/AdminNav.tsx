"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Role } from "@/lib/admin";

interface Item {
  href: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

interface Group {
  label: string;
  items: Item[];
  adminOnly?: boolean;
}

type IconName =
  | "dashboard"
  | "calendar"
  | "list"
  | "queue"
  | "schedule"
  | "service"
  | "customer"
  | "event"
  | "checkin"
  | "chat"
  | "crm"
  | "membership"
  | "report"
  | "line"
  | "message"
  | "menu"
  | "settings"
  | "users";

const GROUPS: Group[] = [
  {
    label: "營運中心",
    items: [
      { href: "/admin/dashboard", label: "總覽", icon: "dashboard" },
      { href: "/admin/calendar", label: "預約日曆", icon: "calendar" },
      { href: "/admin", label: "預約列表", icon: "list" },
      { href: "/admin/queue", label: "報到／叫號", icon: "queue" },
    ],
  },
  {
    label: "排程與服務",
    items: [
      { href: "/admin/schedules", label: "門診排程", icon: "schedule" },
      { href: "/admin/exceptions", label: "休診／加診", icon: "calendar" },
      { href: "/admin/services", label: "看診服務", icon: "service" },
    ],
  },
  {
    label: "客戶與成長",
    items: [
      { href: "/admin/patients", label: "顧客管理", icon: "customer" },
      { href: "/admin/crm", label: "CRM Lite／自動化", icon: "crm" },
      { href: "/admin/memberships", label: "會員與方案", icon: "membership" },
    ],
  },
  {
    label: "活動報名",
    items: [
      { href: "/admin/events", label: "活動與課程", icon: "event" },
      { href: "/admin/registrations", label: "報名名單", icon: "list" },
      { href: "/admin/checkin", label: "報名報到", icon: "checkin" },
    ],
  },
  {
    label: "客戶服務",
    items: [{ href: "/admin/chat", label: "LINE 客服對話", icon: "chat" }],
  },
  {
    label: "分析",
    items: [{ href: "/admin/reports", label: "營運報表", icon: "report" }],
  },
  {
    label: "通訊與入口",
    adminOnly: true,
    items: [
      { href: "/admin/line", label: "LINE 連線", icon: "line" },
      { href: "/admin/replies", label: "自動回覆", icon: "message" },
      { href: "/admin/messages", label: "訊息模板", icon: "message" },
      { href: "/admin/richmenu", label: "Rich Menu", icon: "menu" },
    ],
  },
  {
    label: "系統設定",
    items: [
      { href: "/admin/settings", label: "品牌與系統設定", icon: "settings", adminOnly: true },
      { href: "/admin/users", label: "團隊與權限", icon: "users", adminOnly: true },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, className };
  switch (name) {
    case "dashboard":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" /></svg>;
    case "list":
      return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" /></svg>;
    case "queue":
      return <svg {...common}><path d="M4 6h16M4 12h10M4 18h16" strokeLinecap="round" /><path d="m17 10 3 2-3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "schedule":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>;
    case "service":
      return <svg {...common}><path d="m14.5 6.5 3-3 3 3-3 3M4 20l7.5-7.5M13 8l3 3M4 4l5 5M4 4v4M4 4h4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "customer":
      return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5 20c.7-3.2 3-5 7-5s6.3 1.8 7 5" strokeLinecap="round" /></svg>;
    case "event":
      return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v17H6.5A2.5 2.5 0 0 0 4 22zM4 5.5v14A2.5 2.5 0 0 1 6.5 17H19M8 7h7M8 11h5" strokeLinecap="round" /></svg>;
    case "checkin":
      return <svg {...common}><path d="M4 4h5M4 4v5M20 4h-5M20 4v5M4 20h5M4 20v-5M20 20h-5M20 20v-5" strokeLinecap="round" /><path d="m8 12 2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "chat":
      return <svg {...common}><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.8-.9L4 20l1.2-3.7A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" strokeLinecap="round" /></svg>;
    case "crm":
      return <svg {...common}><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="17" r="2" /><path d="m7.5 8.5 3 6M16.5 8.5l-3 6M8 7h8" strokeLinecap="round" /></svg>;
    case "membership":
      return <svg {...common}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 9h16M8 14h3" strokeLinecap="round" /></svg>;
    case "report":
      return <svg {...common}><path d="M4 19V5M4 19h17" strokeLinecap="round" /><path d="m7 15 3-4 3 2 5-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "line":
      return <svg {...common}><path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1 0-2-.2-2.9-.5L5 20l1-3.1A7 7 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" strokeLinecap="round" /></svg>;
    case "message":
      return <svg {...common}><path d="M5 5h14v11H9l-4 4z" strokeLinejoin="round" /><path d="M8 9h8M8 12h5" strokeLinecap="round" /></svg>;
    case "menu":
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>;
    case "settings":
      return <svg {...common}><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19 13 .1-1-.1-1 2-1.4-2-3.4-2.4 1a8.5 8.5 0 0 0-1.7-1L14.5 3h-5L9 6.2a8.5 8.5 0 0 0-1.7 1L5 6.2 3 9.6 5 11a8.5 8.5 0 0 0 0 2l-2 1.4 2 3.4 2.3-1a8.5 8.5 0 0 0 1.7 1L9.5 21h5l.5-3.2a8.5 8.5 0 0 0 1.7-1l2.4 1 2-3.4z" strokeLinejoin="round" /></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.5-3.2 2.3-5 5.5-5s5 1.8 5.5 5M16 5.5a3 3 0 0 1 0 5.8M17 15c2 .4 3.3 2 3.6 4" strokeLinecap="round" /></svg>;
  }
}

function NavigationContent({ groups, unread, close }: { groups: Group[]; unread: number; close: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-full flex-col bg-[#071c2e] text-white">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f79d1] text-sm font-bold tracking-wide">XH</div>
          <div>
            <div className="text-sm font-semibold tracking-wide">XINHOW</div>
            <div className="mt-0.5 text-[11px] text-slate-400">BOOKING CONSOLE</div>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        {groups.map((group) => (
          <div key={group.label} className="mb-6 last:mb-0">
            <div className="mb-2 px-3 text-[11px] font-semibold tracking-[0.16em] text-slate-500">{group.label}</div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const showBadge = item.href === "/admin/chat" && unread > 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
                      active ? "bg-[#1f79d1] font-semibold text-white shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {showBadge && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-5 py-4 text-[11px] leading-5 text-slate-500">工程後台 · 多品牌資料隔離</div>
    </div>
  );
}

export function AdminNav({ role, chatUnread = 0 }: { role: Role; chatUnread?: number }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(chatUnread);
  const isAdmin = role === "owner" || role === "admin";
  const providerAllowed = new Set(["/admin/dashboard", "/admin/calendar", "/admin", "/admin/queue"]);
  const groups = GROUPS.filter((group) => isAdmin || !group.adminOnly)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isAdmin || (!item.adminOnly && (role !== "provider" || providerAllowed.has(item.href)))),
    }))
    .filter((group) => group.items.length > 0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const response = await fetch("/api/admin/chat?type=unread");
        const body = (await response.json()) as { ok: boolean; data?: { count: number } };
        if (alive && body.ok && body.data) setUnread(body.data.count);
      } catch {
        // unread badge is informative; navigation remains usable if the endpoint is unavailable
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/admin/chat")) setUnread(0);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        aria-label="開啟後台選單"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-30 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[#071c2e] text-white shadow-lg lg:hidden"
      >
        <Icon name="menu" />
      </button>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 shadow-xl lg:block">
        <NavigationContent groups={groups} unread={unread} close={() => undefined} />
      </aside>
      {mobileOpen && (
        <>
          <button type="button" aria-label="關閉後台選單" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" />
          <aside className="fixed inset-y-0 left-0 z-50 w-[min(18rem,88vw)] shadow-2xl lg:hidden">
            <NavigationContent groups={groups} unread={unread} close={() => setMobileOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}
