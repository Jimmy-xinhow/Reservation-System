import { PLATFORM_ADD_ONS, requirePlatformAdmin } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { createPlatformBrandAction, setPlatformBrandActiveAction, updatePlatformEntitlementAction } from "./actions";

export const dynamic = "force-dynamic";

interface BrandRow { id: string; name: string; slug: string | null; line_basic_id: string | null; active: boolean; created_at: string; }
interface EntitlementRow { clinic_id: string; plan_code: "standard" | "professional" | "enterprise"; feature_flags: Record<string, boolean> | null; note: string | null; }
interface MemberRow { clinic_id: string; role: string; }
interface SettingsRow { clinic_id: string; public_registration_enabled: boolean; booking_mode: string; }

export default async function PlatformPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const params = (await searchParams) ?? {};
  const service = createServiceClient();
  const [{ data: brands, error: brandError }, { data: entitlements, error: entitlementError }, { data: members, error: memberError }, { data: settings, error: settingsError }] = await Promise.all([
    service.from("clinics").select("id, name, slug, line_basic_id, active, created_at").order("created_at", { ascending: false }),
    service.from("brand_entitlements").select("clinic_id, plan_code, feature_flags, note"),
    service.from("clinic_members").select("clinic_id, role"),
    service.from("clinic_settings").select("clinic_id, public_registration_enabled, booking_mode"),
  ]);
  if (brandError) throw new Error(`讀取品牌清單失敗：${brandError.message}`);
  if (entitlementError) throw new Error(`讀取品牌方案失敗：${entitlementError.message}`);
  if (memberError) throw new Error(`讀取品牌成員失敗：${memberError.message}`);
  if (settingsError) throw new Error(`讀取品牌設定失敗：${settingsError.message}`);

  const brandRows = (brands ?? []) as BrandRow[];
  const entitlementRows = (entitlements ?? []) as EntitlementRow[];
  const memberRows = (members ?? []) as MemberRow[];
  const settingsByBrand = new Map((settings ?? [] as SettingsRow[]).map((row) => [row.clinic_id, row as SettingsRow]));
  const entitlementByBrand = new Map(entitlementRows.map((row) => [row.clinic_id, row]));
  const membersByBrand = new Map<string, number>();
  for (const member of memberRows) membersByBrand.set(member.clinic_id, (membersByBrand.get(member.clinic_id) ?? 0) + 1);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">SaaS platform</p><h1 className="mt-1 text-2xl font-bold text-slate-950">品牌總管理後台</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">管理品牌租戶、方案與七項另行報價的加購能力；品牌內資料仍由各自的成員權限隔離。</p></div>{params.created === "1" && <span className="badge bg-emerald-50 px-3 py-1.5 text-emerald-700">品牌已建立</span>}</div>
      <div className="grid gap-4 sm:grid-cols-4"><Metric label="品牌總數" value={brandRows.length} /><Metric label="啟用品牌" value={brandRows.filter((brand) => brand.active).length} /><Metric label="品牌成員" value={memberRows.length} /><Metric label="待完成設定" value={brandRows.filter((brand) => !isBrandReady(brand, membersByBrand, settingsByBrand)).length} /></div>

      <form action={createPlatformBrandAction} className="card space-y-5 border-brand-100 bg-brand-50/40 p-5"><div><h2 className="font-semibold text-slate-900">建立新品牌</h2><p className="mt-1 text-xs leading-5 text-slate-500">品牌負責人若尚未有帳號，系統會寄出登入邀請；品牌建立後會自動建立預設設定與 owner 權限。</p></div><div className="grid gap-4 sm:grid-cols-2"><Field label="品牌名稱" name="name" required placeholder="例如：晴日生活" /><Field label="品牌代號" name="slug" required pattern="[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?" placeholder="sunny-life" /><Field label="負責人 Email" name="owner_email" required type="email" placeholder="owner@example.com" /><Field label="聯絡電話" name="phone" placeholder="可留白" /><Field label="品牌地址／備註" name="address" placeholder="可留白" /></div><SubmitButton className="btn btn-primary">建立品牌與負責人權限</SubmitButton></form>

      <section className="space-y-4"><div><h2 className="text-lg font-bold text-slate-900">品牌與服務設定</h2><p className="mt-1 text-sm text-slate-500">70 項標準功能保持開放；方案只作為服務層級與合作備註，不用來隱藏標準功能。停用採 soft-delete，不刪除既有資料。</p><p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">加購勾選僅代表合約／合作備註已確認，不代表功能已交付或會自動啟用；生命週期仍須經需求、報價、開發、驗收與正式交付。</p></div>{brandRows.length === 0 ? <div className="card p-6 text-sm text-slate-500">尚未建立品牌。</div> : <div className="space-y-4">{brandRows.map((brand) => { const entitlement = entitlementByBrand.get(brand.id); const flags = entitlement?.feature_flags ?? {}; const ready = isBrandReady(brand, membersByBrand, settingsByBrand); return <article key={brand.id} className="card space-y-5 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{brand.name}</h3><span className={`badge ${brand.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{brand.active ? "啟用" : "已停用"}</span><span className={`badge ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{ready ? "基本設定完成" : "待完成設定"}</span></div><p className="mt-1 text-xs text-slate-400">/{brand.slug ?? "未設定代號"} · {membersByBrand.get(brand.id) ?? 0} 位成員</p></div><form action={setPlatformBrandActiveAction}><input type="hidden" name="clinic_id" value={brand.id} /><input type="hidden" name="active" value={brand.active ? "false" : "true"} /><SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">{brand.active ? "停用品牌" : "重新啟用"}</SubmitButton></form></div><form action={updatePlatformEntitlementAction} className="space-y-4 border-t border-slate-100 pt-4"><input type="hidden" name="clinic_id" value={brand.id} /><div className="grid gap-4 sm:grid-cols-[220px_1fr]"><label className="text-sm"><span className="label">服務層級（不限制標準功能）</span><select name="plan_code" className="input" defaultValue={entitlement?.plan_code ?? "standard"}><option value="standard">標準維護</option><option value="professional">專案支援</option><option value="enterprise">企業協作</option></select></label><label className="text-sm"><span className="label">平台備註</span><input name="note" className="input" defaultValue={entitlement?.note ?? ""} placeholder="合約、客製範圍或交付備註" /></label></div><div><p className="label">另行報價加購能力（僅記錄合作狀態）</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{PLATFORM_ADD_ONS.map(({ key, label }) => <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><input type="checkbox" name={key} defaultChecked={flags[key] === true} className="h-4 w-4 accent-brand-600" />{label}</label>)}</div></div><SubmitButton className="btn btn-primary px-4 py-2 text-sm">儲存設定</SubmitButton></form></article>; })}</div>}</section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="card p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value}</p></div>; }
function Field({ label, name, type = "text", required = false, pattern, placeholder }: { label: string; name: string; type?: string; required?: boolean; pattern?: string; placeholder?: string }) { return <label className="text-sm"><span className="label">{label}</span><input name={name} type={type} required={required} pattern={pattern} className="input" placeholder={placeholder} /></label>; }
function isBrandReady(brand: BrandRow, membersByBrand: Map<string, number>, settingsByBrand: Map<string, SettingsRow>): boolean { return Boolean(brand.active && brand.slug && brand.line_basic_id && (membersByBrand.get(brand.id) ?? 0) > 0 && settingsByBrand.has(brand.id)); }
