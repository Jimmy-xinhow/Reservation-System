import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProvider } from "./payment";
import { findPaymentOrderByMerchant } from "./payment-order-lookup";

export interface VerifiedPaymentEvent {
  provider: PaymentProvider;
  clinicId: string;
  merchantOrderNo: string;
  providerTransactionNo: string | null;
  eventKey: string;
  success: boolean;
  amount: number;
  payload: Record<string, unknown>;
}

interface PaymentOrderState {
  id: string;
  clinic_id: string;
  registration_id: string | null;
  appointment_id: string | null;
  membership_plan_id: string | null;
  patient_id: string | null;
  amount: number;
  status: string;
  provider: string;
  merchant_order_no: string;
  provider_payload: Record<string, unknown>;
}

async function reconcilePaymentState(supabase: SupabaseClient, order: PaymentOrderState, success: boolean): Promise<void> {
  if (order.registration_id) {
    const { error } = await supabase.rpc("reconcile_registration_payment", {
      p_clinic_id: order.clinic_id,
      p_registration_id: order.registration_id,
      p_success: success,
    });
    if (error) throw new Error(error.message);
  }

  if (order.appointment_id) {
    if (success) {
      const { error } = await supabase.rpc("confirm_appointment_payment", {
        p_clinic_id: order.clinic_id,
        p_appointment_id: order.appointment_id,
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.rpc("fail_appointment_payment", {
        p_clinic_id: order.clinic_id,
        p_appointment_id: order.appointment_id,
        p_note: "payment failed",
      });
      if (error) throw new Error(error.message);
    }
  }

  if (order.membership_plan_id && order.patient_id && success) {
    const { error } = await supabase.rpc("grant_paid_membership_from_order", {
      p_clinic_id: order.clinic_id,
      p_payment_order_id: order.id,
    });
    if (error) throw new Error(error.message);
  }
}

export async function processPaymentWebhook(
  supabase: SupabaseClient,
  event: VerifiedPaymentEvent,
): Promise<{ duplicate: boolean; accepted: boolean; changed: boolean }> {
  if (!event.clinicId || !event.merchantOrderNo || !Number.isInteger(event.amount) || event.amount < 0) {
    throw new Error("付款回呼欄位錯誤");
  }

  const order = await findPaymentOrderByMerchant(supabase, event.clinicId, event.provider, event.merchantOrderNo);
  if (!order) throw new Error("找不到付款訂單");
  if (Number(order.amount) !== event.amount) throw new Error("付款金額不一致");

  // Keep transaction evidence, not arbitrary provider/customer fields or signatures.
  // This fingerprint supports correlation; it is not a replayable signed callback.
  const receipt = {
    receipt_version: 1,
    provider: event.provider,
    merchant_order_no: event.merchantOrderNo,
    provider_transaction_no: event.providerTransactionNo,
    event_key: event.eventKey,
    success: event.success,
    amount: event.amount,
    payload_sha256: createHash("sha256").update(JSON.stringify(event.payload)).digest("hex"),
  };

  const { error: webhookError } = await supabase.from("payment_webhook_events").insert({
    clinic_id: order.clinic_id,
    provider: event.provider,
    event_key: event.eventKey,
    payload: receipt,
  });
  const duplicateEvent = webhookError?.code === "23505";
  if (webhookError) {
    if (!duplicateEvent) throw new Error(webhookError.message);
  }

  // 訂金期限只釋放預約，不能抹去金流商已驗證的收款。
  // 預約確認 RPC 保留 cancelled 狀態；其他終態仍禁止晚到事件倒轉。
  const lateReservationPayment = order.status === "expired" && event.success && Boolean(order.appointment_id || order.registration_id);
  if (order.status !== "pending" && !lateReservationPayment) {
    if ((order.status === "paid" && event.success) || (order.status === "failed" && !event.success)) {
      await reconcilePaymentState(supabase, order, event.success);
    }
    await markWebhookProcessed(supabase, event);
    return { duplicate: duplicateEvent, accepted: order.status === "paid" && event.success, changed: false };
  }

  const { error: transactionError } = await supabase.from("payment_transactions").insert({
    clinic_id: order.clinic_id,
    payment_order_id: order.id,
    provider_transaction_no: event.providerTransactionNo,
    event_key: event.eventKey,
    status: event.success ? "accepted" : "rejected",
    payload: receipt,
  });
  if (transactionError && transactionError.code !== "23505") throw new Error(transactionError.message);

  // Status and audit are committed together; an audit failure rolls back the status.
  const { data: transitioned, error: updateError } = await supabase.rpc("transition_verified_payment", {
    p_clinic_id: order.clinic_id,
    p_order_id: order.id,
    p_provider: event.provider,
    p_expected_status: order.status,
    p_success: event.success,
    p_amount: event.amount,
    p_merchant_order_no: event.merchantOrderNo,
    p_event_key: event.eventKey,
    p_payload: receipt,
  });
  if (updateError) throw new Error(updateError.message);
  if (!transitioned) {
    const currentOrder = await findPaymentOrderByMerchant(supabase, event.clinicId, event.provider, event.merchantOrderNo);
    if (!currentOrder) throw new Error("找不到付款訂單");
    // Expiry can win after our initial read. Re-enter once through the existing
    // late-receipt path; an expired snapshot cannot take this pending-only branch.
    if (order.status === "pending" && currentOrder.status === "expired" && event.success
      && (currentOrder.appointment_id || currentOrder.registration_id)) {
      return processPaymentWebhook(supabase, event);
    }
    if ((currentOrder.status === "paid" && event.success) || (currentOrder.status === "failed" && !event.success)) {
      await reconcilePaymentState(supabase, currentOrder, event.success);
    }
    await markWebhookProcessed(supabase, event);
    return { duplicate: duplicateEvent, accepted: currentOrder.status === "paid" && event.success, changed: false };
  }


  await reconcilePaymentState(supabase, order, event.success);

  await markWebhookProcessed(supabase, event);
  return { duplicate: false, accepted: event.success, changed: true };
}

async function markWebhookProcessed(supabase: SupabaseClient, event: VerifiedPaymentEvent): Promise<void> {
  const { data, error } = await supabase.from("payment_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("clinic_id", event.clinicId).eq("provider", event.provider).eq("event_key", event.eventKey)
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("付款回呼處理紀錄不存在");
}
