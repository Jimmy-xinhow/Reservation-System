import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";
import { createBrandAction } from "../actions";
import { addClinicDomainAction, updateBrandPageAction, updateSettingsAction, updateClinicProfileAction, updateEmailSettingsAction, updatePaymentSettingsAction, verifyClinicDomainAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { emailConfigForClinic } from "@/lib/email";
import { paymentSecretsForClinic } from "@/lib/payment";
import { BrandPageEditor } from "./BrandPageEditor";
import { isBrandPageTemplate, normalizeBrandPageContent, type BrandPageTemplate } from "@/lib/brand-page";

export const dynamic = "force-dynamic";

interface Clinic {
  name: string;
  slug: string | null;
  line_basic_id: string | null;
  line_destination: string | null;
  phone: string | null;
  address: string | null;
  intro: string | null;
}

interface Settings {
  booking_mode: "time" | "number";
  first_visit_extends: boolean;
  first_visit_minutes: number | null;
  allow_multi_patient_per_phone: boolean;
  max_patients_per_phone: number;
  deposit_enabled: boolean;
  deposit_amount: number;
  deposit_scope: "all" | "self_pay" | "none";
  min_lead_minutes: number;
  max_advance_days: number;
  recurring_booking_enabled: boolean;
  max_recurring_occurrences: number;
  cancel_lead_minutes: number;
  reschedule_lead_minutes: number;
  public_booking_enabled: boolean;
  public_registration_enabled: boolean;
  email_enabled: boolean;
  events_enabled: boolean;
  memberships_enabled: boolean;
  crm_automation_enabled: boolean;
  line_channel_enabled: boolean;
  beauty_operations_enabled: boolean;
  brand_page_enabled: boolean;
  brand_page_template: BrandPageTemplate;
  brand_page_content: unknown;
  brand_logo_url: string | null;
}

interface PaymentSettings {
  provider: "ecpay" | "newebpay";
  merchant_id: string;
  environment: "test" | "production";
  active: boolean;
}
interface ClinicDomain { id: string; hostname: string; verification_token: string | null; verified_at: string | null; active: boolean; }
interface LineChannelStatus { verification_status: string | null; liff_id: string | null; }

type SettingsSectionId = "brand" | "page" | "booking" | "channels" | "domain" | "advanced";

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: "brand", label: "品牌資料", description: "顧客看得到的名稱與聯絡資訊" },
  { id: "page", label: "品牌形象頁", description: "選擇模板並編輯公開內容" },
  { id: "booking", label: "預約與入口規則", description: "模式、名額、訂金與公開入口" },
  { id: "channels", label: "付款與通知", description: "金流、LINE 與 Email 狀態" },
  { id: "domain", label: "網址與網域", description: "品牌短網址與自訂網域" },
  { id: "advanced", label: "進階操作", description: "同一帳號新增另一個品牌" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const requestedSection = params.section;
  const activeSection: SettingsSectionId = SETTINGS_SECTIONS.some((item) => item.id === requestedSection)
    ? requestedSection as SettingsSectionId
    : "brand";
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  const [
    { data, error: settingsError },
    { data: clinicData, error: clinicError },
    { data: paymentData, error: paymentError },
    { data: domainData, error: domainError },
    { data: lineChannelData, error: lineChannelError },
  ] = await Promise.all([
    supabase
      .from("clinic_settings")
      .select("booking_mode, first_visit_extends, first_visit_minutes, allow_multi_patient_per_phone, max_patients_per_phone, deposit_enabled, deposit_amount, deposit_scope, min_lead_minutes, max_advance_days, recurring_booking_enabled, max_recurring_occurrences, cancel_lead_minutes, reschedule_lead_minutes, public_booking_enabled, public_registration_enabled, email_enabled, events_enabled, memberships_enabled, crm_automation_enabled, line_channel_enabled, beauty_operations_enabled, brand_page_enabled, brand_page_template, brand_page_content, brand_logo_url")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase
      .from("clinics")
      .select("name, slug, line_basic_id, line_destination, phone, address, intro")
      .eq("id", clinicId)
      .maybeSingle(),
    supabase
      .from("clinic_payment_settings")
      .select("provider, merchant_id, environment, active")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase.from("clinic_domains").select("id, hostname, verification_token, verified_at, active").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
    supabase.from("clinic_line_channels").select("verification_status, liff_id").eq("clinic_id", clinicId).maybeSingle(),
  ]);
  if (settingsError || clinicError || paymentError || domainError || lineChannelError) {
    throw new Error(settingsError?.message ?? clinicError?.message ?? paymentError?.message ?? domainError?.message ?? lineChannelError?.message ?? "品牌設定載入失敗");
  }
  const s = data as Settings | null;
  const clinic = clinicData as Clinic | null;
  const payment = paymentData as PaymentSettings | null;
  const domains = (domainData ?? []) as ClinicDomain[];
  const lineChannel = lineChannelData as LineChannelStatus | null;
  const emailConfigured = Boolean(emailConfigForClinic(clinicId));
  const paymentSecretConfigured = Boolean(paymentSecretsForClinic(clinicId));
  const lineReady = s?.line_channel_enabled === true && lineChannel?.verification_status === "ready" && Boolean(lineChannel.liff_id);

  if (!s) {
    return (
      <div className="card space-y-4 border-red-200 p-5 text-red-800">
        <div><h1 className="text-lg font-semibold">目前無法載入品牌設定</h1><p className="mt-2 text-sm leading-6">請先重新整理頁面。若仍無法開啟，請將此畫面交給系統管理者檢查品牌是否已完成建立，以及你的帳號是否已加入這個品牌。</p></div>
        <details className="technical-details border-red-200 bg-red-50/60"><summary>提供給系統管理者的檢查項目</summary><ol className="mx-5 mb-4 list-decimal space-y-2 text-sm"><li>確認此品牌已有預設設定資料</li><li>確認登入帳號已加入品牌成員名單</li><li>確認資料庫讀取權限規則已套用</li></ol></details>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
        <p className="eyebrow">目前位置：品牌後台</p>
        <h1 className="admin-page-title">品牌與系統設定</h1>
        <p className="admin-page-description">只管理目前選取的品牌；依左側分類完成資料、營運規則與外部渠道設定。</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
      <aside className="border-y border-slate-200 bg-white lg:sticky lg:top-20">
      <nav aria-label="品牌設定分類" className="divide-y divide-slate-200">
        {SETTINGS_SECTIONS.map((item) => {
          const selected = item.id === activeSection;
          return (
            <Link
              key={item.id}
              href={`/admin/settings?section=${item.id}`}
              aria-current={selected ? "page" : undefined}
              className={`block border-l-2 px-4 py-3 transition ${selected ? "border-brand-600 bg-brand-50" : "border-transparent hover:bg-slate-50"}`}
            >
              <span className={`block text-sm font-semibold ${selected ? "text-brand-800" : "text-slate-800"}`}>{item.label}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
            </Link>
          );
        })}
      </nav>

      <div className="divide-y divide-slate-200 border-t border-slate-200">
        <SettingStatus label="LINE 官方帳號" value={!s.line_channel_enabled ? "未啟用" : lineReady ? "已驗證" : "待完成驗證"} ready={lineReady} href="/admin/line" />
        <SettingStatus label="標準金流" value={!payment?.active ? "未啟用" : paymentSecretConfigured ? "已啟用" : "缺少密鑰"} ready={payment?.active === true && paymentSecretConfigured} href="/admin/settings?section=channels" />
        <SettingStatus label="Email 提醒" value={!s.email_enabled ? "未啟用" : emailConfigured ? "已啟用" : "缺少寄件設定"} ready={s.email_enabled && emailConfigured} href="/admin/settings?section=channels" />
        <SettingStatus label="自訂網域" value={domains.some((item) => item.active) ? "已驗證" : domains.length ? "待驗證" : "尚未新增"} ready={domains.some((item) => item.active)} href="/admin/settings?section=domain" />
      </div>
      </aside>
      <div className="min-w-0 space-y-5">

      {activeSection === "advanced" && <form action={createBrandAction} className="card space-y-4 border-brand-100 bg-brand-50/40 p-5">
        <div>
          <p className="eyebrow">同一帳號的進階操作</p>
          <h2 className="mt-1 font-semibold text-slate-900">為目前帳號新增可管理品牌</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">這個功能適合同一位品牌管理者管理多個品牌。建立後會自動建立預設設定，並將目前帳號加入新品牌為品牌管理者；若是替其他使用者開通，請回到系統總控台流程。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">品牌名稱</label>
            <input name="name" className="input" required maxLength={120} placeholder="例如：安心物理治療" />
          </div>
          <div>
            <label className="label">品牌短網址</label>
            <input name="slug" className="input" required maxLength={80} pattern="[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?" placeholder="安心物理治療 → anshin" />
          </div>
          <div>
            <label className="label">公開電話（可選）</label>
            <input name="phone" className="input" maxLength={80} />
          </div>
          <div>
            <label className="label">公開地址（可選）</label>
            <input name="address" className="input" maxLength={240} />
          </div>
        </div>
        <div><SubmitButton className="btn btn-primary">建立品牌並切換</SubmitButton></div>
      </form>}

      {/* 公開品牌資訊(顯示於公開資訊頁) */}
      {activeSection === "brand" && <form action={updateClinicProfileAction} className="card space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">公開品牌資訊</h2>
        <p className="-mt-2 text-xs text-slate-400">顯示於公開資訊頁，顧客看得到。</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">品牌名稱</label>
            <input name="name" className="input" defaultValue={clinic?.name ?? ""} required />
          </div>
          <div>
            <label className="label">品牌短網址</label>
            <input name="slug" className="input" defaultValue={clinic?.slug ?? ""} placeholder="my-brand" pattern="[a-z0-9][a-z0-9-]{0,78}[a-z0-9]?" />
            <p className="mt-1 text-xs text-slate-400">可用 `/register/品牌短網址` 開啟此品牌的活動報名。</p>
          </div>
          <div>
            <label className="label">LINE 官方帳號 ID</label>
            <input
              name="line_basic_id"
              className="input"
              defaultValue={clinic?.line_basic_id ?? ""}
              placeholder="@738xusfj"
            />
            <p className="mt-1 text-xs text-slate-400">用於公開頁的「加入好友/線上預約」按鈕。</p>
          </div>
          <div>
            <label className="label">電話</label>
            <input name="phone" className="input" defaultValue={clinic?.phone ?? ""} />
          </div>
          <div>
            <label className="label">地址</label>
            <input name="address" className="input" defaultValue={clinic?.address ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">簡介</label>
            <textarea
              name="intro"
              rows={2}
              className="input"
              defaultValue={clinic?.intro ?? ""}
              placeholder="例:服務時間、特色方案等"
            />
          </div>
        </div>
        <SubmitButton className="btn btn-primary">儲存公開資訊</SubmitButton>
      </form>}

      {activeSection === "page" && (
        <>
          {params.brand_page_saved === "1" && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">品牌形象頁已儲存，公開入口會立即使用最新內容。</p>}
          <BrandPageEditor
            enabled={s.brand_page_enabled}
            initialTemplate={isBrandPageTemplate(s.brand_page_template) ? s.brand_page_template : "beauty"}
            initialContent={normalizeBrandPageContent(s.brand_page_content, isBrandPageTemplate(s.brand_page_template) ? s.brand_page_template : "beauty")}
            initialLogoUrl={s.brand_logo_url ?? ""}
            publicUrl={clinic?.slug ? `/?clinic_slug=${encodeURIComponent(clinic.slug)}` : null}
            action={updateBrandPageAction}
          />
        </>
      )}

      {activeSection === "booking" && <form action={updateSettingsAction} className="space-y-6">
        <Section title="標準模組">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="events_enabled" defaultChecked={s.events_enabled} />
            啟用活動與報名
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="memberships_enabled" defaultChecked={s.memberships_enabled} />
            啟用會員與套票
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="crm_automation_enabled" defaultChecked={s.crm_automation_enabled} />
            啟用顧客回訪與自動提醒
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="beauty_operations_enabled" defaultChecked={s.beauty_operations_enabled} className="mt-1" />
            <span><span className="block">啟用美業營運</span><span className="block text-xs leading-5 text-slate-500">包含療程紀錄、私密照片、耗材庫存與服務獎金試算；不是完整會計或 POS。</span></span>
          </label>
          <div className="w-full rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            LINE 官方帳號入口：{s.line_channel_enabled ? "已啟用" : "未啟用"}。連線識別碼與檢查請到 <a href="/admin/line" className="font-medium text-brand-700 underline">LINE 官方帳號連線</a> 管理。
          </div>
        </Section>

        {/* 1. 預約模式 */}
        <Section title="預約模式">
          <label className="text-sm">
            模式
            <select name="booking_mode" defaultValue={s.booking_mode} className="input mt-1">
              <option value="time">時間制(選確切時段)</option>
              <option value="number">場次制(選服務場次給號)</option>
            </select>
          </label>
        </Section>

        {/* 2. 首次服務延長 */}
        <Section title="首次服務延長(時間制)">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" name="first_visit_extends" defaultChecked={s.first_visit_extends} />
            首次服務佔較長時段
          </label>
          <label className="text-sm">
            首次服務時間（分鐘；留空時沿用一般設定）
            <input
              type="number"
              name="first_visit_minutes"
              defaultValue={s.first_visit_minutes ?? ""}
              className="input mt-1 w-28"
            />
          </label>
        </Section>

        {/* 3. 一電話多顧客 */}
        <Section title="一電話多顧客">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allow_multi_patient_per_phone"
              className="h-4 w-4 accent-brand-600"
              defaultChecked={s.allow_multi_patient_per_phone}
            />
            允許同一電話登記多名顧客
          </label>
          <label className="text-sm">
            每支電話上限人數
            <input
              type="number"
              name="max_patients_per_phone"
              min={1}
              defaultValue={s.max_patients_per_phone}
              className="input mt-1 w-28"
            />
          </label>
        </Section>

        {/* 4. 訂金 */}
        <Section title="訂金規則">
          <p className="w-full text-xs leading-5 text-slate-500">預約狀態與付款狀態會分開保存；啟用線上付款時，請再到「付款與通知」設定綠界或藍新。</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" name="deposit_enabled" defaultChecked={s.deposit_enabled} />
            啟用訂金
          </label>
          <label className="text-sm">
            金額(TWD)
            <input
              type="number"
              name="deposit_amount"
              min={0}
              defaultValue={s.deposit_amount}
              className="input mt-1 w-28"
            />
          </label>
          <label className="text-sm">
            套用範圍
            <select name="deposit_scope" defaultValue={s.deposit_scope} className="input mt-1">
              <option value="self_pay">僅自費</option>
              <option value="all">全部</option>
              <option value="none">不套用</option>
            </select>
          </label>
        </Section>

        {/* 5. 預約區間 */}
        <Section title="預約區間">
          <label className="text-sm">
            最短前置(分)
            <input
              type="number"
              name="min_lead_minutes"
              min={0}
              defaultValue={s.min_lead_minutes}
              className="input mt-1 w-28"
            />
          </label>
          <label className="text-sm">
            最長可約(天)
            <input
              type="number"
              name="max_advance_days"
              min={1}
              defaultValue={s.max_advance_days}
              className="input mt-1 w-28"
            />
          </label>
          <label className="text-sm">最晚取消提前分鐘<input type="number" name="cancel_lead_minutes" min={0} defaultValue={s.cancel_lead_minutes} className="input mt-1 w-28" /></label>
          <label className="text-sm">最晚改期提前分鐘<input type="number" name="reschedule_lead_minutes" min={0} defaultValue={s.reschedule_lead_minutes} className="input mt-1 w-28" /></label>
        </Section>

        <Section title="重複預約">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" name="recurring_booking_enabled" defaultChecked={s.recurring_booking_enabled} /><span><span className="block font-medium text-slate-700">允許顧客建立每週重複預約</span><span className="mt-1 block text-xs leading-5 text-slate-500">所有週次會在同一交易完成容量檢查；任何一週額滿就不會建立整組。啟用訂金時會暫停顧客端重複預約。</span></span></label>
          <label className="text-sm">單次最多週數<input type="number" name="max_recurring_occurrences" min={2} max={12} defaultValue={s.max_recurring_occurrences} className="input mt-1 w-28" /></label>
        </Section>

        <Section title="公開入口">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" name="public_booking_enabled" defaultChecked={s.public_booking_enabled} />
            開放線上預約
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" name="public_registration_enabled" defaultChecked={s.public_registration_enabled} />
            開放線上報名
          </label>
          {!s.events_enabled && <p className="w-full text-xs text-amber-700">若未同時啟用「活動與報名」模組，公開報名會自動保持關閉。</p>}
        </Section>

        <SubmitButton className="btn btn-primary">儲存設定</SubmitButton>
      </form>}

      {activeSection === "channels" && <section className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">LINE 官方帳號與圖文選單</h2><p className="mt-1 text-sm leading-6 text-slate-600">LINE 連線、顧客入口與圖文選單集中在獨立工作區，並提供白話步驟與進階技術設定。</p></div><Link href="/admin/line" className="btn btn-secondary shrink-0">前往 LINE 設定</Link></section>}

      {activeSection === "channels" && <form action={updatePaymentSettingsAction} className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">標準金流</h2>
          <p className="help-text">支援綠界與藍新標準付款。付款密鑰只保存在伺服器，不會寫入一般資料表或顯示在畫面；退款、對帳與其他金流另行報價。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="text-sm"><span className="label">金流商</span><select name="provider" defaultValue={payment?.provider ?? "ecpay"} className="input"><option value="ecpay">綠界 ECPay</option><option value="newebpay">藍新 NewebPay</option></select></label>
          <label className="text-sm"><span className="label">環境</span><select name="environment" defaultValue={payment?.environment ?? "test"} className="input"><option value="test">測試</option><option value="production">正式</option></select></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={payment?.active ?? false} />啟用付款</label>
        </div>
        <label className="block text-sm"><span className="label">商店代號（Merchant ID）</span><input name="merchant_id" className="input" defaultValue={payment?.merchant_id ?? ""} required /><span className="help-text block">由綠界或藍新提供，用來辨認收款商店。</span></label>
        <p className={`text-sm ${paymentSecretConfigured ? "text-emerald-700" : "text-amber-700"}`}>
          金流密鑰狀態：{paymentSecretConfigured ? "已在伺服器安全設定 ✓" : "尚未設定"}
        </p>
        <SubmitButton className="btn btn-primary">儲存金流設定</SubmitButton>
      </form>}

      {activeSection === "domain" && (
        <section className="card space-y-4 p-5">
          <div>
            <h2 className="font-semibold text-slate-900">自訂網址／網域</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">新增網域後，需要到網址服務商完成所有權驗證。DNS 是網址服務商的網域設定；TXT 是用來證明這個網址屬於品牌的驗證文字。</p>
          </div>
          {clinic?.slug && <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900"><p className="font-medium">目前品牌短網址</p><code className="mt-1 block break-all text-xs">/book/browser?clinic_slug={clinic.slug}　／　/register/{clinic.slug}</code></div>}
          {params.err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">{params.err}</p>}
          <form action={addClinicDomainAction} className="flex flex-col gap-2 sm:flex-row"><input name="hostname" className="input flex-1" placeholder="booking.example.com" required /><SubmitButton className="btn btn-secondary">新增網域</SubmitButton></form>
          {domains.length > 0 ? (
            <div className="space-y-2">{domains.map((domain) => (
              <div key={domain.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{domain.hostname}</span>
                  {domain.active ? <span className="badge bg-emerald-50 text-emerald-700">已啟用</span> : <form action={verifyClinicDomainAction}><input type="hidden" name="id" value={domain.id} /><SubmitButton className="btn btn-secondary px-3 py-1 text-xs">檢查網址設定</SubmitButton></form>}
                </div>
                {!domain.active && (
                  <details className="technical-details mt-3">
                    <summary>查看網址服務商設定資料</summary>
                    <p className="mt-3 text-xs leading-5 text-slate-600">在網址服務商新增 TXT 紀錄，名稱填入 <code>_booking-verification.{domain.hostname}</code>，內容填入下列驗證文字：</p>
                    <code className="mt-2 block break-all rounded-lg bg-white p-3 text-xs text-slate-600">{domain.verification_token}</code>
                  </details>
                )}
              </div>
            ))}</div>
          ) : <p className="text-sm text-slate-500">尚未新增自訂網域；可先使用品牌短網址完成瀏覽器備援與測試。</p>}
        </section>
      )}

      {/* Email 提醒(選用,需自備 Resend 金鑰)*/}
      {activeSection === "channels" && <form action={updateEmailSettingsAction} className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">Email 預約提醒(選用)</h2>
           <p className="mt-1 text-xs text-slate-400">
             Resend 金鑰與寄件人由部署環境管理；請設定該品牌的 server-side 環境變數，此頁只保存啟用狀態。
           </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="email_enabled"
            defaultChecked={s.email_enabled}
            className="h-4 w-4 accent-brand-600"
          />
          啟用 Email 提醒
        </label>
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          寄件人與 Email 服務密鑰：{emailConfigured ? "已在伺服器安全設定 ✓" : "尚未設定"}
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton className="btn btn-primary">儲存 Email 設定</SubmitButton>
        </div>
        <p className="text-xs text-slate-400">
              寄件人網域需先在 Resend 完成驗證;顧客需在「顧客查詢」建檔留有 Email 才會收到。
        </p>
      </form>}
      </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-slate-200 bg-white px-4 py-5 last:border-b-0">
      <legend className="px-0 text-sm font-semibold text-slate-900">{title}</legend>
      <div className="mt-3 flex flex-wrap items-end gap-4">{children}</div>
    </fieldset>
  );
}

function SettingStatus({ label, value, ready, href }: { label: string; value: string; ready: boolean; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50">
      <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>
      <span className={`badge ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{ready ? "就緒" : "待處理"}</span>
    </Link>
  );
}
