export type BrandAccessType = "brand_admin" | "employee";
export type BrandPermission = "brand.manage" | "operations.manage" | "provider.assigned";

export const BRAND_PERMISSION_DEFINITIONS = [
  {
    key: "brand.manage",
    label: "品牌設定與整合",
    description: "服務、排程、LINE、Rich Menu、CRM、會員與品牌設定。",
  },
  {
    key: "operations.manage",
    label: "日常營運管理",
    description: "預約、報名、候補、報到、顧客、客服與營運報表。",
  },
  {
    key: "provider.assigned",
    label: "指派工作處理",
    description: "只查看被指派的服務行程，並更新完成或未到狀態。",
  },
] as const satisfies readonly {
  key: BrandPermission;
  label: string;
  description: string;
}[];

export const BRAND_PERMISSION_KEYS = BRAND_PERMISSION_DEFINITIONS.map(({ key }) => key) as BrandPermission[];

export function normalizeBrandPermissions(value: unknown): BrandPermission[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(BRAND_PERMISSION_KEYS);
  return [...new Set(value.filter((permission): permission is BrandPermission => typeof permission === "string" && allowed.has(permission)))];
}

export function brandAccessLabel(accessType: BrandAccessType): string {
  return accessType === "brand_admin" ? "品牌管理者" : "品牌員工";
}

export function permissionsForLegacyBrandRole(role: string): BrandPermission[] {
  if (role === "owner" || role === "admin") return ["brand.manage", "operations.manage"];
  if (role === "provider") return ["provider.assigned"];
  return ["operations.manage"];
}

export function legacyBrandRoleForPermissions(accessType: BrandAccessType, permissions: readonly BrandPermission[]): "admin" | "staff" | "provider" {
  if (accessType === "brand_admin" || permissions.includes("brand.manage")) return "admin";
  if (permissions.includes("operations.manage")) return "staff";
  if (permissions.includes("provider.assigned")) return "provider";
  return "staff";
}
