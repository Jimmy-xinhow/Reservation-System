import Link from "next/link";

type ServiceTab = "services" | "resources" | "schedules" | "exceptions";
type MembershipTab = "memberships" | "value" | "levels";

const SERVICE_TABS: Array<{ key: ServiceTab; href: string; label: string; description: string }> = [
  { key: "services", href: "/admin/services", label: "服務方案", description: "項目、價格與加購" },
  { key: "resources", href: "/admin/resources", label: "人員與資源", description: "場地、設備與綁定" },
  { key: "schedules", href: "/admin/schedules", label: "服務排程", description: "人員與每週時段" },
  { key: "exceptions", href: "/admin/exceptions", label: "例外日期", description: "休假與臨時加開" },
];

const MEMBERSHIP_TABS: Array<{ key: MembershipTab; href: string; label: string; description: string }> = [
  { key: "memberships", href: "/admin/memberships", label: "會員與套票", description: "套票、禮券與兌換" },
  { key: "value", href: "/admin/customer-value", label: "儲值、點數與訂閱", description: "顧客資產與週期方案" },
  { key: "levels", href: "/admin/membership-levels", label: "會員等級與價格", description: "等級與專屬售價" },
];

function Tabs<T extends string>({ active, items, label }: { active: T; items: Array<{ key: T; href: string; label: string; description: string }>; label: string }) {
  return (
    <nav className="management-tabs" aria-label={label}>
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={active === item.key ? "page" : undefined} className={active === item.key ? "is-active" : ""}>
          <strong>{item.label}</strong>
          <span>{item.description}</span>
        </Link>
      ))}
    </nav>
  );
}

export function ServiceSetupTabs({ active }: { active: ServiceTab }) {
  return <Tabs active={active} items={SERVICE_TABS} label="服務方案與排程設定" />;
}

export function MembershipManagementTabs({ active, showPricing = true }: { active: MembershipTab; showPricing?: boolean }) {
  return <Tabs active={active} items={showPricing ? MEMBERSHIP_TABS : MEMBERSHIP_TABS.filter((item) => item.key !== "levels")} label="會員、套票、儲值訂閱管理" />;
}
