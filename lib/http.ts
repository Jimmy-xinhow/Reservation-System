import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "./rate-limit";

export function ok<T>(data: T) {
  return NextResponse.json({ ok: true, data });
}

export function fail(message: string, status = 400) {
  if (status >= 500) {
    const errorId = randomUUID();
    console.error("[api-error]", {
      errorId,
      status,
      detail: message.replace(/[\r\n\t]+/g, " ").slice(0, 1000),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "系統暫時無法完成操作，請稍後再試。若持續發生，請將錯誤編號提供給服務人員。",
        error_id: errorId,
      },
      { status },
    );
  }
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function rateLimitResponse(req: NextRequest, key: string, limit = 30) {
  const rate = await checkRateLimit(req, key, limit);
  if (rate.allowed) return null;
  const response = fail("操作太頻繁，請稍候再試。", 429);
  response.headers.set("Retry-After", String(rate.retryAfterSeconds));
  return response;
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
}

/** 讀取診所設定;查無回 null。 */
export async function getClinicSettings(
  svc: SupabaseClient,
  clinicId: string,
): Promise<ClinicSettings | null> {
  const { data, error } = await svc
    .from("clinic_settings")
    .select("clinic_id, booking_mode, first_visit_extends, first_visit_minutes, allow_multi_patient_per_phone, max_patients_per_phone, deposit_enabled, deposit_amount, deposit_scope, min_lead_minutes, max_advance_days, recurring_booking_enabled, max_recurring_occurrences, cancel_lead_minutes, reschedule_lead_minutes, public_booking_enabled, public_registration_enabled, email_enabled, events_enabled, memberships_enabled, crm_automation_enabled, line_channel_enabled")
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
    typeof row.recurring_booking_enabled === "boolean" &&
    typeof row.max_recurring_occurrences === "number" &&
    typeof row.cancel_lead_minutes === "number" &&
    typeof row.reschedule_lead_minutes === "number" &&
    typeof row.public_booking_enabled === "boolean" &&
    typeof row.public_registration_enabled === "boolean" &&
    typeof row.email_enabled === "boolean" &&
    typeof row.events_enabled === "boolean" &&
    typeof row.memberships_enabled === "boolean" &&
    typeof row.crm_automation_enabled === "boolean" &&
    typeof row.line_channel_enabled === "boolean"
  );
}
