import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export function ok<T>(data: T) {
  return NextResponse.json({ ok: true, data });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export interface ClinicSettings {
  clinic_id: string;
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

/** 讀取診所設定;查無回 null。 */
export async function getClinicSettings(
  svc: SupabaseClient,
  clinicId: string,
): Promise<ClinicSettings | null> {
  const { data, error } = await svc
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (!isClinicSettings(data)) throw new Error("clinic_settings 設定格式錯誤");
  return data;
}

function isClinicSettings(value: unknown): value is ClinicSettings {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.clinic_id === "string" &&
    (row.booking_mode === "time" || row.booking_mode === "number") &&
    typeof row.first_visit_extends === "boolean" &&
    (row.first_visit_minutes === null || typeof row.first_visit_minutes === "number") &&
    typeof row.allow_multi_patient_per_phone === "boolean" &&
    typeof row.max_patients_per_phone === "number" &&
    typeof row.deposit_enabled === "boolean" &&
    typeof row.deposit_amount === "number" &&
    (row.deposit_scope === "all" || row.deposit_scope === "self_pay" || row.deposit_scope === "none") &&
    typeof row.min_lead_minutes === "number" &&
    typeof row.max_advance_days === "number" &&
    typeof row.email_enabled === "boolean" &&
    (row.resend_api_key === null || typeof row.resend_api_key === "string") &&
    (row.email_from === null || typeof row.email_from === "string")
  );
}
