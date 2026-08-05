import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";
import { addClinicDomainAction, createBrandAction, updateSettingsAction, updateClinicProfileAction, updateEmailSettingsAction, updatePaymentSettingsAction, verifyClinicDomainAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { emailConfigForClinic } from "@/lib/email";
import { paymentSecretsForClinic } from "@/lib/payment";

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
  public_booking_enabled: boolean;
  public_registration_enabled: boolean;
  email_enabled: boolean;
}

interface PaymentSettings {
  provider: "ecpay" | "newebpay";
  merchant_id: string;
  environment: "test" | "production";
  active: boolean;
}
interface ClinicDomain { id: string; hostname: string; verification_token: string | null; verified_at: string | null; active: boolean; }

export default async function SettingsPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  const [{ data }, { data: clinicData }, { data: paymentData }, { data: domainData }] = await Promise.all([
    supabase
      .from("clinic_settings")
      .select("booking_mode, first_visit_extends, first_visit_minutes, allow_multi_patient_per_phone, max_patients_per_phone, deposit_enabled, deposit_amount, deposit_scope, min_lead_minutes, max_advance_days, public_booking_enabled, public_registration_enabled, email_enabled")
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
  ]);
  const s = data as Settings | null;
  const clinic = clinicData as Clinic | null;
  const payment = paymentData as PaymentSettings | null;
  const domains = (domainData ?? []) as ClinicDomain[];
  const emailConfigured = Boolean(emailConfigForClinic(clinicId));
  const paymentSecretConfigured = Boolean(paymentSecretsForClinic(clinicId));

  if (!s) {
    return (
      <div className="space-y-2 text-sm text-red-600">
        <p>讀不到此診所設定。常見原因(資料其實存在時多半是後兩者):</p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>尚未建立此診所的 clinic_settings(請見 README 第一節)。</li>
          <li>此登入帳號尚未對應到本診所(clinic_members 缺一筆 → RLS 讀不到)。</li>
          <li>clinic_settings 的 authenticated SELECT policy 未套用到資料庫。</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">診所設定</h1>

      <form action={createBrandAction} className="card space-y-4 border-brand-100 bg-brand-50/40 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">建立新品牌</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">建立後會自動建立預設設定，並將目前帳號加入新品牌為擁有者；品牌資料與目前品牌分開管理。</p>
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
      </form>

      {/* 公開診所資訊(顯示於公開資訊頁) */}
      <form action={updateClinicProfileAction} className="card space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">公開診所資訊</h2>
        <p className="-mt-2 text-xs text-slate-400">顯示於公開資訊頁,病患看得到。</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">診所名稱</label>
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
            <label className="label">LINE Webhook destination</label>
            <input name="line_destination" className="input" defaultValue={clinic?.line_destination ?? ""} placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            <p className="mt-1 text-xs text-slate-400">填 LINE webhook payload 的 destination，用於多品牌路由。</p>
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
              placeholder="例:看診時間、特色療程等"
            />
          </div>
        </div>
        <SubmitButton className="btn btn-primary">儲存公開資訊</SubmitButton>
      </form>

      <form action={updateSettingsAction} className="space-y-6">
        {/* 1. 預約模式 */}
        <Section title="預約模式">
          <label className="text-sm">
            模式
            <select name="booking_mode" defaultValue={s.booking_mode} className="input mt-1">
              <option value="time">時間制(選確切時段)</option>
              <option value="number">號次制(選診次給號)</option>
            </select>
          </label>
        </Section>

        {/* 2. 初診延長 */}
        <Section title="初診延長(時間制)">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" name="first_visit_extends" defaultChecked={s.first_visit_extends} />
            初診佔較長時段
          </label>
          <label className="text-sm">
            初診時長(分,留空=沿用每格)
            <input
              type="number"
              name="first_visit_minutes"
              defaultValue={s.first_visit_minutes ?? ""}
              className="input mt-1 w-28"
            />
          </label>
        </Section>

        {/* 3. 一電話多病患 */}
        <Section title="一電話多病患">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allow_multi_patient_per_phone"
              className="h-4 w-4 accent-brand-600"
              defaultChecked={s.allow_multi_patient_per_phone}
            />
            允許同一電話登記多名病患
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
        <Section title="訂金(僅記錄狀態,不串金流)">
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
        </Section>

        <SubmitButton className="btn btn-primary">儲存設定</SubmitButton>
      </form>

      <form action={updatePaymentSettingsAction} className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">標準金流</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">支援綠界與藍新標準付款。HashKey／HashIV 只從 server environment 讀取，不寫入資料庫或回傳前端；退款、對帳與其他金流另行報價。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="text-sm"><span className="label">金流商</span><select name="provider" defaultValue={payment?.provider ?? "ecpay"} className="input"><option value="ecpay">綠界 ECPay</option><option value="newebpay">藍新 NewebPay</option></select></label>
          <label className="text-sm"><span className="label">環境</span><select name="environment" defaultValue={payment?.environment ?? "test"} className="input"><option value="test">測試</option><option value="production">正式</option></select></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={payment?.active ?? false} />啟用付款</label>
        </div>
        <label className="block text-sm"><span className="label">Merchant ID</span><input name="merchant_id" className="input" defaultValue={payment?.merchant_id ?? ""} required /></label>
        <p className={`text-sm ${paymentSecretConfigured ? "text-emerald-700" : "text-amber-700"}`}>
          金流密鑰狀態：{paymentSecretConfigured ? "已由 server environment 設定 ✓" : "尚未設定"}
        </p>
        <SubmitButton className="btn btn-primary">儲存金流設定</SubmitButton>
      </form>

      <section className="card space-y-4 p-5"><div><h2 className="font-semibold text-slate-900">自訂網址／網域</h2><p className="mt-1 text-xs leading-5 text-slate-400">新增網域後，請在 DNS 建立 TXT：<code>_booking-verification.你的網域</code>，再按驗證。驗證成功後才會作為品牌公開入口。</p></div><form action={addClinicDomainAction} className="flex flex-col gap-2 sm:flex-row"><input name="hostname" className="input flex-1" placeholder="booking.example.com" required /><SubmitButton className="btn btn-secondary">新增網域</SubmitButton></form>{domains.length > 0 && <div className="space-y-2">{domains.map((domain) => <div key={domain.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-800">{domain.hostname}</span>{domain.active ? <span className="badge bg-emerald-50 text-emerald-700">已啟用</span> : <form action={verifyClinicDomainAction}><input type="hidden" name="id" value={domain.id} /><SubmitButton className="btn btn-secondary px-3 py-1 text-xs">驗證 DNS</SubmitButton></form>}</div>{!domain.active && <code className="mt-2 block break-all text-xs text-slate-500">TXT 值：{domain.verification_token}</code>}</div>)}</div>}</section>

      {/* Email 提醒(選用,需自備 Resend 金鑰)*/}
      <form action={updateEmailSettingsAction} className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">Email 看診提醒(選用)</h2>
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
          寄件人與 Resend 金鑰狀態：{emailConfigured ? "已由 server environment 設定 ✓" : "尚未設定"}
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton className="btn btn-primary">儲存 Email 設定</SubmitButton>
        </div>
        <p className="text-xs text-slate-400">
          寄件人網域需先在 Resend 完成驗證;病患需在「病患查詢」建檔留有 Email 才會收到。
        </p>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card p-5">
      <legend className="px-2 text-sm font-semibold text-brand-700">{title}</legend>
      <div className="flex flex-wrap items-end gap-4">{children}</div>
    </fieldset>
  );
}
