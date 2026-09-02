export type PlatformAccessType = "system_admin" | "employee";
export type SystemPermission =
  | "platform.overview"
  | "brands.manage"
  | "entitlements.manage"
  | "operations.view"
  | "reports.view"
  | "audit.view"
  | "settings.view";

export const SYSTEM_PERMISSION_DEFINITIONS = [
  { key: "platform.overview", label: "系統總覽", description: "查看品牌開通狀態與跨品牌摘要。" },
  { key: "brands.manage", label: "品牌管理", description: "建立、啟用或停用品牌。" },
  { key: "entitlements.manage", label: "方案與加購管理", description: "調整品牌方案、加購狀態與交付備註。" },
  { key: "operations.view", label: "營運健康", description: "查看通知、金流與部署健康狀態。" },
  { key: "reports.view", label: "跨品牌報表", description: "查看跨品牌彙總數據，不顯示顧客個資。" },
  { key: "audit.view", label: "系統稽核", description: "查看跨品牌狀態異動紀錄。" },
  { key: "settings.view", label: "系統設定", description: "查看系統政策與部署能力狀態。" },
] as const satisfies readonly {
  key: SystemPermission;
  label: string;
  description: string;
}[];

export const SYSTEM_PERMISSION_KEYS = SYSTEM_PERMISSION_DEFINITIONS.map(({ key }) => key) as SystemPermission[];

export function normalizeSystemPermissions(value: unknown): SystemPermission[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(SYSTEM_PERMISSION_KEYS);
  return [...new Set(value.filter((permission): permission is SystemPermission => typeof permission === "string" && allowed.has(permission)))];
}

export function platformAccessLabel(accessType: PlatformAccessType): string {
  return accessType === "system_admin" ? "系統管理者" : "系統員工";
}
