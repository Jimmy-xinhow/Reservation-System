"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }
function integer(fd: FormData, key: string): number { const value = Number(text(fd, key)); if (!Number.isInteger(value)) throw new Error("請輸入整數"); return value; }
function refresh(): void { revalidatePath("/admin/customer-value"); revalidatePath("/admin/patients"); }

export async function adjustWalletAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const kind = text(fd, "kind");
  const amount = Math.abs(integer(fd, "amount"));
  if (!amount || !["top_up", "purchase", "refund", "adjust"].includes(kind)) throw new Error("儲值異動資料不正確");
  const delta = kind === "purchase" ? -amount : kind === "adjust" && text(fd, "direction") === "debit" ? -amount : amount;
  const { error } = await createServiceClient().rpc("adjust_customer_wallet", { p_clinic_id: member.clinicId, p_actor_user_id: member.user.id, p_patient_id: text(fd, "patient_id"), p_amount_delta: delta, p_kind: kind, p_note: text(fd, "note") || null, p_sales_order_id: null, p_idempotency_key: null });
  if (error) throw new Error(error.message.includes("insufficient") ? "顧客儲值餘額不足" : error.message);
  refresh();
}

export async function adjustPointsAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const kind = text(fd, "kind");
  const points = Math.abs(integer(fd, "points"));
  if (!points || !["earn", "redeem", "expire", "adjust"].includes(kind)) throw new Error("點數異動資料不正確");
  const delta = ["redeem", "expire"].includes(kind) ? -points : kind === "adjust" && text(fd, "direction") === "debit" ? -points : points;
  const { error } = await createServiceClient().rpc("adjust_loyalty_points", { p_clinic_id: member.clinicId, p_actor_user_id: member.user.id, p_patient_id: text(fd, "patient_id"), p_points_delta: delta, p_kind: kind, p_note: text(fd, "note") || null, p_sales_order_id: null, p_idempotency_key: null });
  if (error) throw new Error(error.message.includes("insufficient") ? "顧客點數不足" : error.message);
  refresh();
}

export async function createSubscriptionPlanAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const name = text(fd, "name");
  const interval = text(fd, "billing_interval");
  if (!name || !["monthly", "quarterly", "yearly"].includes(interval)) throw new Error("訂閱方案資料不正確");
  const benefits = text(fd, "benefits").split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  const { error } = await createServiceClient().from("subscription_plans").insert({ clinic_id: member.clinicId, name: name.slice(0, 100), description: text(fd, "description").slice(0, 500) || null, price: Math.max(0, integer(fd, "price")), billing_interval: interval, included_credits: Math.max(0, integer(fd, "included_credits")), benefits, active: true });
  if (error) throw new Error(error.message);
  refresh();
}

export async function toggleSubscriptionPlanAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const { error } = await createServiceClient().from("subscription_plans").update({ active: text(fd, "active") !== "true" }).eq("id", text(fd, "id")).eq("clinic_id", member.clinicId);
  if (error) throw new Error(error.message);
  refresh();
}

export async function createPatientSubscriptionAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const { error } = await createServiceClient().rpc("create_patient_subscription", { p_clinic_id: member.clinicId, p_actor_user_id: member.user.id, p_patient_id: text(fd, "patient_id"), p_plan_id: text(fd, "plan_id"), p_note: text(fd, "note") || null });
  if (error) throw new Error(error.message.includes("duplicate key") ? "顧客已有這個有效訂閱方案" : error.message);
  refresh();
}

export async function setPatientSubscriptionStatusAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const status = text(fd, "status");
  if (!["active", "paused", "cancelled"].includes(status)) throw new Error("訂閱狀態不正確");
  const { error } = await createServiceClient().rpc("set_patient_subscription_status", { p_clinic_id: member.clinicId, p_actor_user_id: member.user.id, p_subscription_id: text(fd, "id"), p_status: status });
  if (error) throw new Error(error.message);
  refresh();
}
