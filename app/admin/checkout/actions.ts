"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function positiveNumber(fd: FormData, key: string): number {
  const value = Number(text(fd, key));
  if (!Number.isFinite(value) || value <= 0) throw new Error("數量必須大於 0");
  return value;
}

function nonNegativeInteger(fd: FormData, key: string): number {
  const value = Number(text(fd, key));
  if (!Number.isFinite(value) || value < 0) throw new Error("金額格式不正確");
  return Math.round(value);
}

function parseScopedValue(value: string): { kind: string; id: string } {
  const [kind, id] = value.split(":", 2);
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id ?? "")) throw new Error("選擇的資料格式不正確");
  return { kind, id };
}

export async function createSalesOrderAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const source = parseScopedValue(text(fd, "source"));
  const discount = nonNegativeInteger(fd, "discount_amount");
  const args = {
    p_clinic_id: member.clinicId,
    p_actor_user_id: member.user.id,
    p_appointment_id: source.kind === "appointment" ? source.id : null,
    p_registration_id: source.kind === "registration" ? source.id : null,
    p_patient_id: source.kind === "patient" ? source.id : null,
    p_discount_amount: discount,
    p_note: text(fd, "note") || null,
  };
  if (!["appointment", "registration", "patient"].includes(source.kind)) throw new Error("結帳來源不正確");
  const { data, error } = await createServiceClient().rpc("create_sales_order", args);
  if (error) {
    if (error.message.includes("discount exceeds")) throw new Error("折扣不可超過銷售金額");
    if (error.message.includes("not eligible")) throw new Error("這筆預約或報名目前不能結帳");
    throw new Error(error.message);
  }
  if (typeof data !== "string") throw new Error("銷售單建立失敗");
  revalidatePath("/admin/checkout");
  redirect(`/admin/checkout?order_id=${encodeURIComponent(data)}`);
}

export async function addCatalogSalesItemAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const orderId = text(fd, "order_id");
  const catalog = parseScopedValue(text(fd, "catalog_item"));
  if (!["service", "product", "package"].includes(catalog.kind)) throw new Error("銷售品項類型不正確");
  const { error } = await createServiceClient().rpc("add_sales_order_item", {
    p_clinic_id: member.clinicId,
    p_actor_user_id: member.user.id,
    p_order_id: orderId,
    p_kind: catalog.kind,
    p_reference_id: catalog.id,
    p_name: null,
    p_quantity: positiveNumber(fd, "quantity"),
    p_unit_price: 0,
  });
  if (error) {
    if (error.message.includes("insufficient inventory")) throw new Error("商品庫存不足，無法加入銷售單");
    if (error.message.includes("cannot be changed")) throw new Error("已結清的銷售單不能再加品項");
    throw new Error(error.message);
  }
  revalidatePath("/admin/checkout");
}

export async function addCustomSalesItemAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const name = text(fd, "name");
  if (!name) throw new Error("請填寫品項名稱");
  const { error } = await createServiceClient().rpc("add_sales_order_item", {
    p_clinic_id: member.clinicId,
    p_actor_user_id: member.user.id,
    p_order_id: text(fd, "order_id"),
    p_kind: "custom",
    p_reference_id: null,
    p_name: name.slice(0, 160),
    p_quantity: positiveNumber(fd, "quantity"),
    p_unit_price: nonNegativeInteger(fd, "unit_price"),
  });
  if (error) throw new Error(error.message.includes("cannot be changed") ? "已結清的銷售單不能再加品項" : error.message);
  revalidatePath("/admin/checkout");
}

export async function recordSalesPaymentAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const method = text(fd, "method");
  if (!["cash", "card", "transfer", "online", "other"].includes(method)) throw new Error("請選擇正確的收款方式");
  const { error } = await createServiceClient().rpc("record_sales_payment", {
    p_clinic_id: member.clinicId,
    p_actor_user_id: member.user.id,
    p_order_id: text(fd, "order_id"),
    p_method: method,
    p_amount: Math.round(positiveNumber(fd, "amount")),
    p_reference: text(fd, "reference") || null,
  });
  if (error) {
    if (error.message.includes("exceeds outstanding")) throw new Error("收款金額不可超過未收金額");
    if (error.message.includes("cannot receive")) throw new Error("這張銷售單目前不能再收款");
    throw new Error(error.message);
  }
  revalidatePath("/admin/checkout");
}
