import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { updateSettingsAction, updateClinicProfileAction, updateEmailSettingsAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

interface Clinic {
  name: string;
  line_basic_id: string | null;
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
  email_enabled: boolean;
  resend_api_key: string | null;
  email_from: string | null;
}

export default async function SettingsPage() {
  const supabase = await createSupabaseServer();
  const [{ data }, { data: clinicData }] = await Promise.all([
    supabase.from("clinic_settings").select("*").eq("clinic_id", CLINIC_ID).maybeSingle(),
    supabase
      .from("clinics")
      .select("name, line_basic_id, phone, address, intro")
      .eq("id", CLINIC_ID)
      .maybeSingle(),
  ]);
  const s = data as Settings | null;
  const clinic = clinicData as Clinic | null;

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

        <SubmitButton className="btn btn-primary">儲存設定</SubmitButton>
      </form>

      {/* Email 提醒(選用,需自備 Resend 金鑰)*/}
      <form action={updateEmailSettingsAction} className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">Email 看診提醒(選用)</h2>
          <p className="mt-1 text-xs text-slate-400">
            自行到 resend.com 申請 API 金鑰(免費約 3,000 封/月)填入即可啟用。留空不影響 LINE 提醒。
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">寄件人</span>
            <input
              name="email_from"
              defaultValue={s.email_from ?? ""}
              placeholder="慈愛中醫 <noreply@yourdomain.com>"
              className="input"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Resend API 金鑰</span>
            <input
              name="resend_api_key"
              type="password"
              placeholder={s.resend_api_key ? "已設定(留空不變,輸入 - 清除)" : "re_..."}
              className="input"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton className="btn btn-primary">儲存 Email 設定</SubmitButton>
          <span className={`text-xs ${s.resend_api_key ? "text-accent-600" : "text-slate-400"}`}>
            金鑰狀態:{s.resend_api_key ? "已設定 ✓" : "未設定"}
          </span>
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
