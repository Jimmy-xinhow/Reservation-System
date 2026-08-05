import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProvider } from "./payment";

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
  amount: number;
  status: string;
  provider: string;
}

async function reconcilePaymentState(supabase: SupabaseClient, order: PaymentOrderState, success: boolean): Promise<void> {
  if (order.registration_id) {
    const registrationPatch = success
      ? { payment_status: "paid", status: "confirmed", expires_at: null }
      : { payment_status: "failed", status: "cancelled", expires_at: null };
    const { data: updatedRegistration, error } = await supabase
      .from("registrations")
      .update(registrationPatch)
      .eq("id", order.registration_id)
      .eq("clinic_id", order.clinic_id)
      .in("status", ["pending", "confirmed"])
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (updatedRegistration) {
      const benefitResult = await supabase.rpc(success ? "apply_registration_benefits" : "release_registration_benefits", {
        p_clinic_id: order.clinic_id,
        p_registration_id: order.registration_id,
      });
      if (benefitResult.error) throw new Error(benefitResult.error.message);
    }
  }

  if (order.appointment_id) {
    if (success) {
      const { error } = await supabase
        .from("appointments")
        .update({ deposit_status: "paid", status: "confirmed", deposit_expires_at: null })
        .eq("id", order.appointment_id)
        .eq("clinic_id", order.clinic_id)
        .in("status", ["booked", "confirmed"]);
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
}

export async function processPaymentWebhook(
  supabase: SupabaseClient,
  event: VerifiedPaymentEvent,
): Promise<{ duplicate: boolean; accepted: boolean; changed: boolean }> {
  if (!event.clinicId || !event.merchantOrderNo || !Number.isInteger(event.amount) || event.amount < 0) {
    throw new Error("付款回呼欄位錯誤");
  }

  const { data: order, error: orderError } = await supabase
    .from("payment_orders")
    .select("id, clinic_id, registration_id, appointment_id, amount, status, provider")
    .eq("provider", event.provider)
    .eq("clinic_id", event.clinicId)
    .eq("merchant_order_no", event.merchantOrderNo)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error("找不到付款訂單");
  if (Number(order.amount) !== event.amount) throw new Error("付款金額不一致");

  const { error: webhookError } = await supabase.from("payment_webhook_events").insert({
    clinic_id: order.clinic_id,
    provider: event.provider,
    event_key: event.eventKey,
    payload: event.payload,
  });
  const duplicateEvent = webhookError?.code === "23505";
  if (webhookError) {
    if (!duplicateEvent) throw new Error(webhookError.message);
  }

  // 付款訂單一旦進入終態，不接受另一個晚到回呼倒轉狀態；只保留 webhook audit。
  // 這也避免已付款訂單因晚到的失敗事件被改成 failed/cancelled。
  if (order.status !== "pending") {
    if ((order.status === "paid" && event.success) || (order.status === "failed" && !event.success)) {
      await reconcilePaymentState(supabase, order, event.success);
    }
    await supabase
      .from("payment_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", event.provider)
      .eq("event_key", event.eventKey);
    return { duplicate: duplicateEvent, accepted: order.status === "paid" && event.success, changed: false };
  }

  const nextStatus = event.success ? "paid" : "failed";
  const { error: transactionError } = await supabase.from("payment_transactions").insert({
    clinic_id: order.clinic_id,
    payment_order_id: order.id,
    provider_transaction_no: event.providerTransactionNo,
    event_key: event.eventKey,
    status: event.success ? "accepted" : "rejected",
    payload: event.payload,
  });
  if (transactionError && transactionError.code !== "23505") throw new Error(transactionError.message);

  // 條件式更新是第二道冪等門；同時到達的不同回呼只有一個能轉移 pending。
  const { data: transitioned, error: updateError } = await supabase
    .from("payment_orders")
    .update({ status: nextStatus, provider_payload: event.payload, updated_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!transitioned) {
    await supabase
      .from("payment_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", event.provider)
      .eq("event_key", event.eventKey);
    return { duplicate: false, accepted: event.success, changed: false };
  }

  await supabase.from("payment_status_events").insert({
    clinic_id: order.clinic_id,
    payment_order_id: order.id,
    from_status: order.status,
    to_status: nextStatus,
    source: `${event.provider}_webhook`,
    provider_event_key: event.eventKey,
  });

  await reconcilePaymentState(supabase, order, event.success);

  await supabase
    .from("payment_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", event.provider)
    .eq("event_key", event.eventKey);
  return { duplicate: false, accepted: event.success, changed: true };
}
