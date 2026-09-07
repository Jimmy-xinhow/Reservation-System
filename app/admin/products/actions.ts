"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function nonNegativeNumber(fd: FormData, key: string, label: string): number {
  const raw = text(fd, key);
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed < 0) throw new Error(`${label}必須是 0 以上的數字`);
  return parsed;
}

function productValues(fd: FormData) {
  const name = text(fd, "name");
  const sku = text(fd, "sku").toUpperCase();
  const unit = text(fd, "unit") || "件";
  if (!name) throw new Error("請填寫商品名稱");
  if (name.length > 160) throw new Error("商品名稱不可超過 160 字");
  if (sku.length > 60) throw new Error("商品編號不可超過 60 字");
  if (unit.length > 20) throw new Error("計算單位不可超過 20 字");
  return {
    name,
    sku: sku || null,
    unit,
    reorder_level: nonNegativeNumber(fd, "reorder_level", "補貨提醒量"),
    retail_price: Math.round(nonNegativeNumber(fd, "retail_price", "商品售價")),
  };
}

function revalidateProductViews(): void {
  revalidatePath("/admin/products");
  revalidatePath("/admin/checkout");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/beauty");
  revalidatePath("/admin/beauty/supply");
}

function friendlyError(message: string): string {
  if (message.includes("inventory_items_clinic_id_sku_key") || message.includes("duplicate key")) return "這個商品編號已被使用，請改用其他編號";
  return message;
}

export async function createProductAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const values = productValues(fd);
  const stock = nonNegativeNumber(fd, "stock_on_hand", "初始庫存");
  const { error } = await createServiceClient().from("inventory_items").insert({
    clinic_id: member.clinicId,
    ...values,
    stock_on_hand: stock,
    active: true,
  });
  if (error) throw new Error(friendlyError(error.message));
  revalidateProductViews();
}

export async function updateProductAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const id = text(fd, "id");
  if (!id) throw new Error("缺少要修改的商品");
  const { data, error } = await createServiceClient()
    .from("inventory_items")
    .update(productValues(fd))
    .eq("id", id)
    .eq("clinic_id", member.clinicId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(friendlyError(error.message));
  if (!data) throw new Error("找不到目前品牌的商品");
  revalidateProductViews();
}

export async function toggleProductAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  if (!id) throw new Error("缺少要調整的商品");
  const { data, error } = await createServiceClient()
    .from("inventory_items")
    .update({ active })
    .eq("id", id)
    .eq("clinic_id", member.clinicId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("找不到目前品牌的商品");
  revalidateProductViews();
}

export async function recordProductMovementAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const id = text(fd, "item_id");
  const kind = text(fd, "kind");
  const quantity = Number(text(fd, "quantity"));
  if (!id || !["stock_in", "use", "sale", "waste"].includes(kind) || !Number.isFinite(quantity) || quantity <= 0) throw new Error("庫存異動資料不正確");
  const { error } = await createServiceClient().rpc("record_inventory_movement", {
    p_clinic_id: member.clinicId,
    p_item_id: id,
    p_kind: kind,
    p_quantity: quantity,
    p_note: text(fd, "note") || null,
    p_actor_user_id: member.user.id,
  });
  if (error) throw new Error(error.message.includes("insufficient") ? "目前庫存不足，無法扣除" : error.message);
  revalidateProductViews();
}
