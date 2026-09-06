import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProvider } from "./payment";

const MERCHANT_ORDER_HISTORY_KEY = "_merchant_order_history";

export interface PaymentOrderLookup {
  id: string;
  clinic_id: string;
  registration_id: string | null;
  appointment_id: string | null;
  membership_plan_id: string | null;
  patient_id: string | null;
  amount: number;
  status: string;
  provider: PaymentProvider;
  merchant_order_no: string;
  expires_at: string | null;
  return_path: string | null;
  provider_payload: Record<string, unknown>;
}

function asPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function addMerchantOrderToHistory(value: unknown, merchantOrderNo: string): Record<string, unknown> {
  const payload = asPayload(value);
  const currentHistory = Array.isArray(payload[MERCHANT_ORDER_HISTORY_KEY])
    ? (payload[MERCHANT_ORDER_HISTORY_KEY] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  return {
    ...payload,
    [MERCHANT_ORDER_HISTORY_KEY]: Array.from(new Set([...currentHistory, merchantOrderNo])).slice(-20),
  };
}

export function mergePaymentProviderEvent(
  value: unknown,
  merchantOrderNo: string,
  eventPayload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...asPayload(value),
    last_merchant_order_no: merchantOrderNo,
    last_event: eventPayload,
  };
}

const PAYMENT_ORDER_COLUMNS = [
  "id",
  "clinic_id",
  "registration_id",
  "appointment_id",
  "membership_plan_id",
  "patient_id",
  "amount",
  "status",
  "provider",
  "merchant_order_no",
  "expires_at",
  "return_path",
  "provider_payload",
].join(", ");

export async function findPaymentOrderByMerchant(
  supabase: SupabaseClient,
  clinicId: string,
  provider: PaymentProvider,
  merchantOrderNo: string,
): Promise<PaymentOrderLookup | null> {
  const { data: current, error: currentError } = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_COLUMNS)
    .eq("clinic_id", clinicId)
    .eq("provider", provider)
    .eq("merchant_order_no", merchantOrderNo)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);
  if (current) return current as unknown as PaymentOrderLookup;

  const { data: historical, error: historyError } = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_COLUMNS)
    .eq("clinic_id", clinicId)
    .eq("provider", provider)
    .contains("provider_payload", { [MERCHANT_ORDER_HISTORY_KEY]: [merchantOrderNo] })
    .maybeSingle();
  if (historyError) throw new Error(historyError.message);
  return historical ? (historical as unknown as PaymentOrderLookup) : null;
}
