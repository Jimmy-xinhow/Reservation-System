"use client";

import { useState } from "react";
import { BRAND_PERMISSION_DEFINITIONS, normalizeBrandPermissions, type BrandPermission } from "@/lib/access-control";
import { normalizeSystemPermissions, SYSTEM_PERMISSION_DEFINITIONS, type SystemPermission } from "@/lib/platform-roles";

const BRAND_PRESETS: Array<{ key: string; label: string; permissions: BrandPermission[] }> = [
  { key: "frontdesk", label: "櫃檯營運", permissions: ["operations.manage"] },
  { key: "provider", label: "服務提供者", permissions: ["provider.assigned"] },
  { key: "integration", label: "品牌整合", permissions: ["brand.manage"] },
  { key: "manager", label: "營運主管", permissions: ["brand.manage", "operations.manage"] },
];

const SYSTEM_PRESETS: Array<{ key: string; label: string; permissions: SystemPermission[] }> = [
  { key: "onboarding", label: "品牌開通", permissions: ["platform.overview", "brands.manage"] },
  { key: "operations", label: "營運監控", permissions: ["platform.overview", "operations.view"] },
  { key: "analyst", label: "報表分析", permissions: ["platform.overview", "reports.view"] },
  { key: "audit", label: "稽核設定", permissions: ["platform.overview", "audit.view", "settings.view"] },
];

export function BrandPermissionPicker({ defaults = ["operations.manage"], compact = false }: { defaults?: readonly BrandPermission[]; compact?: boolean }) {
  const [selected, setSelected] = useState<BrandPermission[]>(normalizeBrandPermissions(defaults));
  const applyPreset = (key: string) => {
    const preset = BRAND_PRESETS.find((item) => item.key === key);
    if (preset) setSelected(preset.permissions);
  };
  return (
    <fieldset className={`rounded-xl border border-slate-200 bg-slate-50 ${compact ? "p-3" : "w-full p-4"}`}>
      <legend className="px-1 text-sm font-medium text-slate-700">員工工作權限</legend>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs text-slate-600"><span className="mb-1 block font-medium">快速套用範本</span><select className="input h-10 py-1 text-xs" defaultValue="" onChange={(event) => applyPreset(event.target.value)}><option value="" disabled>選擇工作範本</option>{BRAND_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}</select></label>
        <span className="text-xs leading-5 text-slate-500">套用後仍可自行增減權限。</span>
      </div>
      <div className={`grid gap-2 ${compact ? "sm:grid-cols-2" : "md:grid-cols-3"}`}>{BRAND_PERMISSION_DEFINITIONS.map((permission) => <label key={permission.key} className="flex min-h-11 items-start gap-2 rounded-lg bg-white p-3 text-sm"><input type="checkbox" name="permissions" value={permission.key} checked={selected.includes(permission.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, permission.key] : current.filter((item) => item !== permission.key))} className="mt-1 h-4 w-4 accent-brand-600" /><span><strong className="block text-slate-800">{permission.label}</strong>{!compact && <span className="mt-1 block text-xs leading-5 text-slate-500">{permission.description}</span>}</span></label>)}</div>
    </fieldset>
  );
}

export function SystemPermissionPicker({ defaults = ["platform.overview"] }: { defaults?: readonly SystemPermission[] }) {
  const [selected, setSelected] = useState<SystemPermission[]>(normalizeSystemPermissions(defaults));
  const applyPreset = (key: string) => {
    const preset = SYSTEM_PRESETS.find((item) => item.key === key);
    if (preset) setSelected(preset.permissions);
  };
  return (
    <fieldset className="rounded-xl border border-indigo-100 bg-white p-4">
      <legend className="px-1 text-sm font-medium text-slate-700">系統員工工作權限</legend>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs text-slate-600"><span className="mb-1 block font-medium">快速套用範本</span><select className="input h-10 py-1 text-xs" defaultValue="" onChange={(event) => applyPreset(event.target.value)}><option value="" disabled>選擇工作範本</option>{SYSTEM_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}</select></label><span className="text-xs leading-5 text-slate-500">套用後仍可自行增減；系統管理者不受此清單限制。</span></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{SYSTEM_PERMISSION_DEFINITIONS.map((permission) => <label key={permission.key} className="flex min-h-11 items-start gap-2 rounded-lg border border-slate-100 p-3 text-sm"><input type="checkbox" name="permissions" value={permission.key} checked={selected.includes(permission.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, permission.key] : current.filter((item) => item !== permission.key))} className="mt-1 h-4 w-4 accent-indigo-600" /><span><strong className="block text-slate-800">{permission.label}</strong><span className="mt-1 block text-xs leading-5 text-slate-500">{permission.description}</span></span></label>)}</div>
    </fieldset>
  );
}
