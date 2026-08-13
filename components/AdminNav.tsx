"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { Role } from "@/lib/admin";
import type { PlatformAccessType, SystemPermission } from "@/lib/platform-roles";

interface Item {
  href: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
  systemAdminOnly?: boolean;
  systemPermission?: SystemPermission;
  exact?: boolean;
  module?: keyof AdminModuleVisibility;
}

interface Group {
  label: string;
  items: Item[];
  adminOnly?: boolean;
  platformOnly?: boolean;
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
  | "users"
  | "platform";

export interface AdminModuleVisibility {
  events: boolean;
  memberships: boolean;
  crm: boolean;
  line: boolean;
  legacy: boolean;
}

const GROUPS: Group[] = [
  {
    label: "今日工作台",
    items: [{ href: "/admin/dashboard", label: "今日工作台", icon: "dashboard" }],
  },
  {
    label: "預約營運",
    items: [
      { href: "/admin/calendar", label: "預約日曆", icon: "calendar" },
      { href: "/admin", label: "預約列表", icon: "list", exact: true },
      { href: "/admin/handoff", label: "交班待辦", icon: "checkin" },
      { href: "/admin/queue", label: "舊版服務進度", icon: "queue", module: "legacy" },
    ],
  },
  {
    label: "活動與報名",
    items: [
      { href: "/admin/events", label: "活動與課程", icon: "event", module: "events" },
      { href: "/admin/registrations", label: "報名名單", icon: "list", module: "events" },
      { href: "/admin/checkin", label: "報名報到", icon: "checkin", module: "events" },
    ],
  },
  {
    label: "顧客與會員",
    items: [
      { href: "/admin/patients", label: "顧客管理", icon: "customer" },
      { href: "/admin/memberships", label: "會員與套票", icon: "membership", module: "memberships" },
      { href: "/admin/membership-levels", label: "會員等級與價格", icon: "membership", module: "memberships", adminOnly: true },
      { href: "/admin/crm", label: "CRM Lite／自動化", icon: "crm", module: "crm", adminOnly: true },
    ],
  },
  {
    label: "訊息中心",
    items: [
      { href: "/admin/chat", label: "客服對話", icon: "chat", module: "line" },
      { href: "/admin/replies", label: "自動回覆", icon: "message", module: "line", adminOnly: true },
      { href: "/admin/messages", label: "訊息模板", icon: "message", module: "line", adminOnly: true },
      { href: "/admin/line-templates", label: "LINE UI 模板", icon: "line", module: "line", adminOnly: true },
    ],
  },
  {
    label: "報表",
    items: [{ href: "/admin/reports", label: "營運報表", icon: "report" }],
  },
  {
    label: "設定中心",
    adminOnly: true,
    items: [
      { href: "/admin/settings", label: "品牌與規則", icon: "settings" },
      { href: "/admin/import", label: "CSV 資料匯入", icon: "list" },
      { href: "/admin/channels", label: "渠道測試中心", icon: "line" },
      { href: "/admin/services", label: "服務與方案", icon: "service" },
      { href: "/admin/resources", label: "人員與資源", icon: "service" },
      { href: "/admin/schedules", label: "服務排程", icon: "schedule" },
      { href: "/admin/exceptions", label: "例外日期", icon: "calendar" },
      { href: "/admin/line", label: "LINE／LIFF 連線", icon: "line" },
      { href: "/admin/richmenu", label: "Rich Menu", icon: "menu", module: "line" },
      { href: "/admin/users", label: "團隊與權限", icon: "users" },
      { href: "/admin/audit", label: "操作與狀態稽核", icon: "settings" },
    ],
  },
  {
    label: "系統管理",
    platformOnly: true,
    items: [
      { href: "/admin/platform", label: "系統總覽", icon: "dashboard", exact: true, systemPermission: "platform.overview" },
      { href: "/admin/platform/admins", label: "系統人員與權限", icon: "users", systemAdminOnly: true },
      { href: "/admin/platform/operations", label: "營運健康", icon: "schedule", systemPermission: "operations.view" },
      { href: "/admin/platform/reports", label: "跨品牌報表", icon: "report", systemPermission: "reports.view" },
      { href: "/admin/platform/audit", label: "系統稽核", icon: "settings", systemPermission: "audit.view" },
      { href: "/admin/platform/settings", label: "系統設定", icon: "settings", systemPermission: "settings.view" },
    ],
  },
];

function isActive(pathname: string, href: string, exact = false): boolean {
  return href === "/admin" || exact ? pathname === href : pathname.startsWith(href);
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
    case "platform":
      return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></svg>;
  }
}

function NavigationContent({ groups, unread, close, mode }: { groups: Group[]; unread: number; close: () => void; mode: "brand" | "platform" }) {
  const pathname = usePathname();
  const navId = useId().replace(/:/g, "");
  const activeGroupLabel = groups.find((group) => group.items.some((item) => isActive(pathname, item.href, item.exact)))?.label ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupLabel);

  useEffect(() => {
    if (activeGroupLabel) setOpenGroup(activeGroupLabel);
  }, [activeGroupLabel]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#071c2e] text-white">
      <div className={`border-b border-white/10 px-5 py-5 ${mode === "platform" ? "bg-[#18245b]" : "bg-[#071c2e]"}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold tracking-wide ${mode === "platform" ? "bg-white text-[#18245b]" : "bg-[#1f79d1] text-white"}`}>{mode === "platform" ? "XP" : "XH"}</div>
          <div>
            <div className="text-sm font-semibold tracking-wide">{mode === "platform" ? "XINHOW PLATFORM" : "XINHOW"}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">{mode === "platform" ? "系統管理總控台" : "BOOKING CONSOLE"}</div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5">
        {groups.map((group, index) => {
          const groupOpen = openGroup === group.label;
          const groupId = `${navId}-group-${index}`;
          if (group.items.length === 1) {
            return <div key={group.label} className="mb-2 last:mb-0"><NavItem item={group.items[0]} pathname={pathname} unread={unread} close={close} /></div>;
          }
          return (
            <div key={group.label} className="mb-3 last:mb-0">
              <button
                type="button"
                aria-expanded={groupOpen}
                aria-controls={groupId}
                onClick={() => setOpenGroup(groupOpen ? null : group.label)}
                className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-[11px] font-semibold tracking-[0.16em] text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <span className={`transition-transform ${groupOpen ? "rotate-90" : ""}`} aria-hidden="true">›</span>
                <span className="flex-1">{group.label}</span>
                <span className="text-[10px] font-normal tracking-normal text-slate-500">{group.items.length}</span>
              </button>
              {groupOpen && <div id={groupId} className="mt-1 space-y-1">{group.items.map((item) => <NavItem key={item.href} item={item} pathname={pathname} unread={unread} close={close} />)}</div>}
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 px-5 py-4 text-[11px] leading-5 text-slate-500">{mode === "platform" ? "系統總控台 · 跨品牌管理" : "營運後台 · 品牌資料隔離"}</div>
    </div>
  );
}

function NavItem({ item, pathname, unread, close }: { item: Item; pathname: string; unread: number; close: () => void }) {
  const active = isActive(pathname, item.href, item.exact);
  const showBadge = item.href === "/admin/chat" && unread > 0;
  return (
    <Link
      href={item.href}
      onClick={close}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 ${
        active ? "bg-[#1f79d1] font-semibold text-white shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {showBadge && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

export function AdminNav({ role, chatUnread = 0, isPlatformAdmin = false, platformAccessType = null, platformPermissions = [], hasBrandContext = true, modules = { events: true, memberships: true, crm: true, line: true, legacy: false } }: { role: Role; chatUnread?: number; isPlatformAdmin?: boolean; platformAccessType?: PlatformAccessType | null; platformPermissions?: SystemPermission[]; hasBrandContext?: boolean; modules?: AdminModuleVisibility }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(chatUnread);
  const isAdmin = role === "owner" || role === "admin";
  const mode: "brand" | "platform" = isPlatformAdmin && (!hasBrandContext || pathname.startsWith("/admin/platform")) ? "platform" : "brand";
  const providerAllowed = new Set(["/admin/dashboard", "/admin/calendar", "/admin"]);
  const groups = GROUPS.filter((group) => (isAdmin || !group.adminOnly) && (mode === "platform" ? group.platformOnly === true : !group.platformOnly))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (!item.systemAdminOnly || platformAccessType === "system_admin") && (!item.systemPermission || platformAccessType === "system_admin" || platformPermissions.includes(item.systemPermission)) && (!item.module || modules[item.module]) && (isAdmin || (!item.adminOnly && (role !== "provider" || providerAllowed.has(item.href))))),
    }))
    .filter((group) => group.items.length > 0);

  useEffect(() => {
    if (mode !== "brand") return;
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
    const timer = window.setInterval(() => void tick(), 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [mode]);

  useEffect(() => {
    if (pathname.startsWith("/admin/chat")) setUnread(0);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

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
        <NavigationContent groups={groups} unread={unread} close={() => undefined} mode={mode} />
      </aside>
      {mobileOpen && (
        <>
          <button type="button" aria-label="關閉後台選單" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" />
          <aside role="dialog" aria-modal="true" aria-label={mode === "platform" ? "系統管理選單" : "品牌營運選單"} className="fixed inset-y-0 left-0 z-50 w-[min(18rem,88vw)] shadow-2xl lg:hidden">
            <NavigationContent groups={groups} unread={unread} close={() => setMobileOpen(false)} mode={mode} />
          </aside>
        </>
      )}
    </>
  );
}
