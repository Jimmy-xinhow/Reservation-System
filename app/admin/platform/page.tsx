import Link from "next/link";
import { PLATFORM_ADD_ONS, hasSystemPermission, requireSystemPermission } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { createPlatformBrandAction, setPlatformBrandActiveAction, updatePlatformEntitlementAction } from "./actions";

export const dynamic = "force-dynamic";

interface BrandRow { id: string; name: string; slug: string | null; line_basic_id: string | null; active: boolean; created_at: string; }
interface EntitlementRow { clinic_id: string; plan_code: "standard" | "professional" | "enterprise"; feature_flags: Record<string, boolean> | null; note: string | null; }
interface MemberRow { clinic_id: string; role: string; }
interface SettingsRow { clinic_id: string; public_registration_enabled: boolean; public_booking_enabled: boolean; booking_mode: string; }
interface ClinicCountRow { clinic_id: string; }
type PlatformSectionId = "overview" | "create" | "brands";

export default async function PlatformPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const platform = await requireSystemPermission("platform.overview");
  const canManageBrands = hasSystemPermission(platform, "brands.manage");
  const canManageEntitlements = hasSystemPermission(platform, "entitlements.manage");
  const params = (await searchParams) ?? {};
  const requestedSection = typeof params.section === "string" ? params.section : "overview";
  const activeSection: PlatformSectionId = requestedSection === "brands" || (requestedSection === "create" && canManageBrands)
    ? requestedSection
    : "overview";
  const service = createServiceClient();
  const [
    { data: brands, error: brandError },
    { data: entitlements, error: entitlementError },
    { data: members, error: memberError },
    { data: settings, error: settingsError },
    { data: services, error: serviceError },
    { data: schedules, error: scheduleError },
    { count: appointmentCount, error: appointmentCountError },
    { count: registrationCount, error: registrationCountError },
    { count: patientCount, error: patientCountError },
    { count: failedDeliveryCount, error: failedDeliveryError },
  ] = await Promise.all([
    service.from("clinics").select("id, name, slug, line_basic_id, active, created_at").order("created_at", { ascending: false }),
    service.from("brand_entitlements").select("clinic_id, plan_code, feature_flags, note"),
    service.from("clinic_members").select("clinic_id, role"),
    service.from("clinic_settings").select("clinic_id, public_registration_enabled, public_booking_enabled, booking_mode"),
    service.from("services").select("clinic_id").eq("active", true),
    service.from("schedule_templates").select("clinic_id").eq("active", true),
    service.from("appointments").select("id", { count: "exact", head: true }),
    service.from("registrations").select("id", { count: "exact", head: true }),
    service.from("patients").select("id", { count: "exact", head: true }),
    service.from("crm_delivery_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  if (brandError) throw new Error(`讀取品牌清單失敗：${brandError.message}`);
  if (entitlementError) throw new Error(`讀取品牌方案失敗：${entitlementError.message}`);
  if (memberError) throw new Error(`讀取品牌成員失敗：${memberError.message}`);
  if (settingsError) throw new Error(`讀取品牌設定失敗：${settingsError.message}`);
  if (serviceError) throw new Error(`讀取品牌服務失敗：${serviceError.message}`);
  if (scheduleError) throw new Error(`讀取品牌排程失敗：${scheduleError.message}`);
  if (appointmentCountError) throw new Error(`讀取預約統計失敗：${appointmentCountError.message}`);
  if (registrationCountError) throw new Error(`讀取報名統計失敗：${registrationCountError.message}`);
  if (patientCountError) throw new Error(`讀取顧客統計失敗：${patientCountError.message}`);
  if (failedDeliveryError) throw new Error(`讀取訊息失敗統計失敗：${failedDeliveryError.message}`);

  const brandRows = (brands ?? []) as BrandRow[];
  const entitlementRows = (entitlements ?? []) as EntitlementRow[];
  const memberRows = (members ?? []) as MemberRow[];
  const settingsByBrand = new Map((settings ?? []).map((row) => [row.clinic_id, row as SettingsRow]));
  const entitlementByBrand = new Map(entitlementRows.map((row) => [row.clinic_id, row]));
  const membersByBrand = countByClinic(memberRows);
  const servicesByBrand = countByClinic((services ?? []) as ClinicCountRow[]);
  const schedulesByBrand = countByClinic((schedules ?? []) as ClinicCountRow[]);
  const progressByBrand = new Map(brandRows.map((brand) => [brand.id, getBrandProgress(brand, membersByBrand, settingsByBrand, servicesByBrand, schedulesByBrand)]));
  const readyCount = brandRows.filter((brand) => progressByBrand.get(brand.id)?.complete === true).length;

  return (
    <div className="platform-workbench">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">系統管理</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">系統管理控制台</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">這裡管理 XINHOW SaaS 的品牌、開通交付與系統政策；品牌服務、預約、顧客與通知設定，必須由各品牌進入自己的品牌後台管理。</p>
        </div>
        {params.created === "1" && <span className="badge bg-emerald-50 px-3 py-1.5 text-emerald-700">品牌已建立，請通知品牌管理者查收登入資訊</span>}
      </header>

      <nav aria-label="系統管理任務" className="platform-command-tabs">
        <PlatformTaskLink href="/admin/platform?section=overview" label="營運總覽" description="平台指標、健康與治理入口" selected={activeSection === "overview"} />
        {canManageBrands && <PlatformTaskLink href="/admin/platform?section=create" label="建立新品牌" description="建立品牌並寄送管理者邀請" selected={activeSection === "create"} />}
        <PlatformTaskLink href="/admin/platform?section=brands" label="品牌交付狀態" description="追蹤開通進度與方案備註" selected={activeSection === "brands"} />
      </nav>

      {params.notice === "permission" && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          你的系統員工權限未包含剛才的功能，因此已安全返回系統總覽。若工作需要使用該功能，請由系統管理者到「系統人員與權限」調整授權。
        </div>
      )}

      {activeSection === "overview" && <OnboardingGuide />}

      {activeSection === "overview" && <div className="platform-metrics">
        <Metric label="品牌總數" value={brandRows.length} detail={`${brandRows.filter((brand) => brand.active).length} 個啟用中`} />
        <Metric label="品牌成員" value={memberRows.length} detail="跨品牌成員總數" />
        <Metric label="累計預約" value={appointmentCount ?? 0} detail="所有品牌" />
        <Metric label="累計報名" value={registrationCount ?? 0} detail="所有品牌" />
        <Metric label="累計顧客" value={patientCount ?? 0} detail="品牌資料隔離統計" />
        <Metric label="完成基本開通" value={readyCount} detail={`${brandRows.length === 0 ? 0 : Math.round((readyCount / brandRows.length) * 100)}% 品牌`} />
        <Metric label="啟用服務" value={servicesByBrandTotal(servicesByBrand)} detail="跨品牌服務總數" />
        <Metric label="投遞失敗" value={failedDeliveryCount ?? 0} detail="CRM 訊息需處理" tone="warning" />
      </div>}

      {activeSection === "overview" && <section className="platform-panel platform-link-list">
        {platform.accessType === "system_admin" && <QuickLink href="/admin/platform/admins" eyebrow="人員權限" title="系統人員與權限" description="新增系統管理者，並授權系統員工。" />}
        {hasSystemPermission(platform, "operations.view") && <QuickLink href="/admin/platform/operations" eyebrow="運作狀態" title="檢查系統健康" description="查看通知、金流與部署能力。" />}
        {hasSystemPermission(platform, "reports.view") && <QuickLink href="/admin/platform/reports" eyebrow="使用概況" title="查看跨品牌報表" description="比較品牌活躍度與使用量。" />}
        {hasSystemPermission(platform, "audit.view") && <QuickLink href="/admin/platform/audit" eyebrow="操作追蹤" title="查看系統稽核" description="追蹤跨品牌狀態異動。" />}
      </section>}

      {activeSection === "create" && canManageBrands && <form action={createPlatformBrandAction} className="platform-panel space-y-5 p-5">
        <div>
          <p className="eyebrow">第一步 · 建立品牌</p>
          <h2 className="mt-1 font-semibold text-slate-900">建立新品牌並交給品牌管理者</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">填寫品牌資料與品牌管理者 Email。系統會建立品牌、預設設定與品牌管理者權限；若 Email 尚未有帳號，會寄出登入邀請。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="品牌名稱" name="name" required placeholder="例如：晴日生活" />
          <Field label="品牌代號" name="slug" required pattern="[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?" placeholder="sunny-life" hint="用於公開入口網址，只能使用小寫英文、數字與連字號。" />
          <Field label="品牌管理者 Email" name="owner_email" required type="email" placeholder="admin@example.com" hint="這個人會收到登入邀請，並成為品牌管理者。" />
          <Field label="聯絡電話" name="phone" placeholder="可留白" />
          <Field label="品牌地址／備註" name="address" placeholder="可留白" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="btn btn-primary">建立品牌並寄送登入邀請</SubmitButton>
          <span className="text-xs text-slate-500">建立後請把 `/admin/login` 與邀請信交給品牌管理者。</span>
        </div>
      </form>}

      {activeSection === "brands" && <section className="platform-panel">
        <div className="platform-panel-header">
          <div>
          <h2 className="text-lg font-bold text-slate-900">品牌與交付狀態</h2>
          <p className="mt-1 text-sm text-slate-500">系統層負責建立品牌與交接；每個品牌的服務、排程、入口、通知與員工權限，由品牌管理者在品牌後台完成。</p>
          </div>
        </div>
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800">70 項標準功能保持開放；七項加購只記錄合作狀態，不會自動隱藏功能或代表功能已交付。</p>
        {brandRows.length === 0 ? <div className="p-6 text-sm text-slate-500">尚未建立品牌，請先完成「建立新品牌」。</div> : <div className="platform-brand-list">{brandRows.map((brand) => {
          const entitlement = entitlementByBrand.get(brand.id);
          const flags = entitlement?.feature_flags ?? {};
          const progress = progressByBrand.get(brand.id) ?? getBrandProgress(brand, membersByBrand, settingsByBrand, servicesByBrand, schedulesByBrand);
          return <BrandCard key={brand.id} brand={brand} entitlement={entitlement} flags={flags} progress={progress} canManageBrands={canManageBrands} canManageEntitlements={canManageEntitlements} />;
        })}</div>}
      </section>}
    </div>
  );
}

function OnboardingGuide() {
  const steps = [
    ["建立品牌", "系統管理者輸入品牌名稱、代號與品牌管理者 Email。"],
    ["管理者接受邀請", "品牌管理者從 Email 完成登入，再進入今日工作台。"],
    ["完成品牌設定", "依序建立服務、服務排程，最後開啟公開入口。"],
  ];
  return <section className="platform-panel"><div className="platform-panel-header"><div><p className="eyebrow">品牌開通流程</p><h2>把品牌交給正確的人完成設定</h2><p>系統管理者建立品牌；品牌管理者接手服務、排程與公開入口。</p></div><Link href="/admin/login" className="admin-inline-action">品牌登入入口 <span aria-hidden="true">↗</span></Link></div><ol className="platform-flow-list">{steps.map(([title, description], index) => <li key={title} className="platform-flow-step"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><p>{description}</p></div></li>)}</ol></section>;
}

function BrandCard({ brand, entitlement, flags, progress, canManageBrands, canManageEntitlements }: { brand: BrandRow; entitlement?: EntitlementRow; flags: Record<string, boolean>; progress: BrandProgress; canManageBrands: boolean; canManageEntitlements: boolean }) {
  return <article className="platform-brand-row">
    <div className="platform-brand-row-head">
      <div><div className="platform-brand-row-title"><h3>{brand.name}</h3><span className={`badge ${brand.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{brand.active ? "啟用" : "已停用"}</span><span className={`badge ${progress.complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{progress.complete ? "可開始營運" : `待完成 ${progress.total - progress.done} 項`}</span></div><p className="mt-1 text-xs text-slate-500">網址代號：/{brand.slug ?? "未設定"} · {progress.members} 位品牌成員</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/admin/login" className="btn btn-secondary px-3 py-1.5 text-xs">品牌登入入口</Link>{brand.slug && <a href={`/book/browser?clinic_slug=${encodeURIComponent(brand.slug)}`} target="_blank" rel="noreferrer" className="btn btn-secondary px-3 py-1.5 text-xs">預覽顧客入口</a>}{canManageBrands && <form action={setPlatformBrandActiveAction}><input type="hidden" name="clinic_id" value={brand.id} /><input type="hidden" name="active" value={brand.active ? "false" : "true"} /><SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">{brand.active ? "停用品牌" : "重新啟用"}</SubmitButton></form>}</div>
    </div>
    <div className="platform-brand-progress" aria-label={`${brand.name} 開通進度`}>{progress.items.map((item) => <span key={item.label} data-complete={item.done}>{item.done ? "完成 · " : "待辦 · "}{item.label}</span>)}</div>{progress.next && <p className="mt-2 text-xs text-amber-700">下一步：{progress.next}</p>}
    {canManageEntitlements ? <form action={updatePlatformEntitlementAction} className="space-y-4 border-t border-slate-100 pt-4"><input type="hidden" name="clinic_id" value={brand.id} /><div className="grid gap-4 sm:grid-cols-[220px_1fr]"><label className="text-sm"><span className="label">服務層級（不限制標準功能）</span><select name="plan_code" className="input" defaultValue={entitlement?.plan_code ?? "standard"}><option value="standard">標準維護</option><option value="professional">專案支援</option><option value="enterprise">企業協作</option></select></label><label className="text-sm"><span className="label">系統備註</span><input name="note" className="input" defaultValue={entitlement?.note ?? ""} placeholder="合約、客製範圍或交付備註" /></label></div><div><p className="label">另行報價加購能力（僅記錄合作狀態）</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{PLATFORM_ADD_ONS.map(({ key, label }) => <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><input type="checkbox" name={key} defaultChecked={flags[key] === true} className="h-4 w-4 accent-brand-600" />{label}</label>)}</div></div><SubmitButton className="btn btn-primary px-4 py-2 text-sm">儲存設定</SubmitButton></form> : <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">目前帳號可查看方案摘要，但沒有修改方案與加購的權限。</p>}
  </article>;
}

interface BrandProgress { done: number; total: number; complete: boolean; members: number; next: string; items: Array<{ label: string; done: boolean }>; }

function getBrandProgress(brand: BrandRow, membersByBrand: Map<string, number>, settingsByBrand: Map<string, SettingsRow>, servicesByBrand: Map<string, number>, schedulesByBrand: Map<string, number>): BrandProgress {
  const settings = settingsByBrand.get(brand.id);
  const items = [
    { label: "品牌管理者權限", done: (membersByBrand.get(brand.id) ?? 0) > 0 },
    { label: "品牌短網址", done: Boolean(brand.slug) },
    { label: "公開品牌識別", done: Boolean(brand.line_basic_id) },
    { label: "至少一項服務", done: (servicesByBrand.get(brand.id) ?? 0) > 0 },
    { label: "至少一段服務排程", done: (schedulesByBrand.get(brand.id) ?? 0) > 0 },
    { label: "開啟顧客入口", done: Boolean(settings?.public_booking_enabled || settings?.public_registration_enabled) },
  ];
  const next = items.find((item) => !item.done)?.label ?? "基本開通已完成，可交由品牌開始營運";
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, complete: Boolean(brand.active && done === items.length), members: membersByBrand.get(brand.id) ?? 0, next, items };
}

function countByClinic(rows: ClinicCountRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.clinic_id, (counts.get(row.clinic_id) ?? 0) + 1);
  return counts;
}

function servicesByBrandTotal(counts: Map<string, number>): number { let total = 0; for (const count of counts.values()) total += count; return total; }
function Metric({ label, value, detail, tone = "default" }: { label: string; value: number; detail: string; tone?: "default" | "warning" }) { return <div className="platform-metric" data-tone={tone}><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>; }
function QuickLink({ href, eyebrow, title, description }: { href: string; eyebrow: string; title: string; description: string }) { return <Link href={href} className="platform-link-row"><span><small>{eyebrow}</small><strong>{title}</strong><small>{description}</small></span><span aria-hidden="true">→</span></Link>; }
function PlatformTaskLink({ href, label, description, selected }: { href: string; label: string; description: string; selected: boolean }) { return <Link href={href} aria-current={selected ? "page" : undefined} data-selected={selected} className="platform-command-tab"><strong>{label}</strong><span>{description}</span></Link>; }
function Field({ label, name, type = "text", required = false, pattern, placeholder, hint }: { label: string; name: string; type?: string; required?: boolean; pattern?: string; placeholder?: string; hint?: string }) { return <label className="text-sm"><span className="label">{label}</span><input name={name} type={type} required={required} pattern={pattern} className="input" placeholder={placeholder} />{hint && <span className="mt-1 block text-xs leading-5 text-slate-400">{hint}</span>}</label>; }
