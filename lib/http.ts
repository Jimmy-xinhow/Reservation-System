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
  return (data as ClinicSettings | null) ?? null;
}
