import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { updateSettingsAction } from "../actions";

export const dynamic = "force-dynamic";

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
}

export default async function SettingsPage() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", CLINIC_ID)
    .maybeSingle();
  const s = data as Settings | null;

  if (!s) {
    return <p className="text-red-600">查無診所設定,請先於 Supabase insert 一筆 clinic_settings。</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">診所設定</h1>
      <form action={updateSettingsAction} className="space-y-6">
        {/* 1. 預約模式 */}
        <Section title="預約模式">
          <label className="text-sm">
            模式
            <select name="booking_mode" defaultValue={s.booking_mode} className="mt-1 block rounded border p-2">
              <option value="time">時間制(選確切時段)</option>
              <option value="number">號次制(選診次給號)</option>
            </select>
          </label>
        </Section>

        {/* 2. 初診延長 */}
        <Section title="初診延長(時間制)">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="first_visit_extends" defaultChecked={s.first_visit_extends} />
            初診佔較長時段
          </label>
          <label className="text-sm">
            初診時長(分,留空=沿用每格)
            <input
              type="number"
              name="first_visit_minutes"
              defaultValue={s.first_visit_minutes ?? ""}
              className="mt-1 block w-28 rounded border p-2"
            />
          </label>
        </Section>

        {/* 3. 一電話多病患 */}
        <Section title="一電話多病患">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allow_multi_patient_per_phone"
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
              className="mt-1 block w-28 rounded border p-2"
            />
          </label>
        </Section>

        {/* 4. 訂金 */}
        <Section title="訂金(僅記錄狀態,不串金流)">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="deposit_enabled" defaultChecked={s.deposit_enabled} />
            啟用訂金
          </label>
          <label className="text-sm">
            金額(TWD)
            <input
              type="number"
              name="deposit_amount"
              min={0}
              defaultValue={s.deposit_amount}
              className="mt-1 block w-28 rounded border p-2"
            />
          </label>
          <label className="text-sm">
            套用範圍
            <select name="deposit_scope" defaultValue={s.deposit_scope} className="mt-1 block rounded border p-2">
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
              className="mt-1 block w-28 rounded border p-2"
            />
          </label>
          <label className="text-sm">
            最長可約(天)
            <input
              type="number"
              name="max_advance_days"
              min={1}
              defaultValue={s.max_advance_days}
              className="mt-1 block w-28 rounded border p-2"
            />
          </label>
        </Section>

        <button className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white">儲存設定</button>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border bg-white p-4">
      <legend className="px-2 text-sm font-semibold text-gray-700">{title}</legend>
      <div className="flex flex-wrap items-end gap-4">{children}</div>
    </fieldset>
  );
}
