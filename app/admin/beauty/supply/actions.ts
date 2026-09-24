"use server";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";


import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }
function number(fd: FormData, key: string): number { const value = Number(text(fd, key)); if (!Number.isFinite(value)) throw new Error("數量或金額格式不正確"); return value; }
function refresh(): void { revalidatePath("/admin/beauty/supply"); revalidatePath("/admin/beauty"); revalidatePath("/admin/operations/finance"); revalidatePath("/admin/dashboard"); }

export async function createSupplierAction(fd: FormData): Promise<void> {
  const member = await requireAdmin(); const name = text(fd, "name"); if (!name) throw new Error("請填供應商名稱");
  const { error } = await adminQuery(createServiceClient().from("inventory_suppliers").insert({ clinic_id: member.clinicId, name: name.slice(0,160), contact_name: text(fd,"contact_name").slice(0,100)||null, phone: text(fd,"phone").slice(0,40)||null, email: text(fd,"email").slice(0,160)||null, note: text(fd,"note").slice(0,500)||null, active: true }));
  if (error) throw new Error(adminErrorMessage(error)); refresh();
}

export async function createPurchaseOrderAction(fd: FormData): Promise<void> {
  const member = await requireOperator(); const service=createServiceClient(); const supplierId=text(fd,"supplier_id"); const itemId=text(fd,"item_id"); const quantity=number(fd,"quantity"); const cost=Math.round(number(fd,"unit_cost"));
  if (!supplierId||!itemId||quantity<=0||cost<0) throw new Error("採購資料不完整");
  const [{data:supplier},{data:item}] = await adminQuery(Promise.all([service.from("inventory_suppliers").select("id").eq("id",supplierId).eq("clinic_id",member.clinicId).eq("active",true).maybeSingle(),service.from("inventory_items").select("id").eq("id",itemId).eq("clinic_id",member.clinicId).eq("active",true).maybeSingle()]));
  if(!supplier||!item) throw new Error("供應商或品項不屬於目前品牌");
  const {data:order,error:orderError}=await adminQuery(service.from("purchase_orders").insert({clinic_id:member.clinicId,supplier_id:supplierId,status:"draft",expected_at:text(fd,"expected_at")||null,note:text(fd,"note").slice(0,500)||null,created_by:member.user.id}).select("id").single());
  if(orderError) throw new Error(adminErrorMessage(orderError));
  const {error:itemError}=await adminQuery(service.from("purchase_order_items").insert({clinic_id:member.clinicId,purchase_order_id:order.id,item_id:itemId,quantity,unit_cost:cost}));
  if(itemError){await adminQuery(service.from("purchase_orders").delete().eq("id",order.id).eq("clinic_id",member.clinicId));throw new Error(adminErrorMessage(itemError));}
  refresh();redirect(`/admin/beauty/supply?order_id=${encodeURIComponent(order.id)}`);
}

export async function addPurchaseOrderItemAction(fd: FormData): Promise<void> {
  const member=await requireOperator();
  const quantity=number(fd,"quantity");
  const cost=Math.round(number(fd,"unit_cost"));
  const orderId=text(fd,"order_id");
  const itemId=text(fd,"item_id");
  if(!orderId||!itemId||quantity<=0||cost<0)throw new Error("採購數量或成本不正確");
  const service=createServiceClient();
  const [{data:order,error:orderError},{data:item,error:itemError}]=await adminQuery(Promise.all([
    service.from("purchase_orders").select("id,status").eq("id",orderId).eq("clinic_id",member.clinicId).maybeSingle(),
    service.from("inventory_items").select("id").eq("id",itemId).eq("clinic_id",member.clinicId).eq("active",true).maybeSingle(),
  ]));
  if(orderError||itemError)throw new Error(adminErrorMessage(orderError??itemError));
  if(!order||order.status!=="draft"||!item)throw new Error("採購單或品項不屬於目前品牌，或採購單已非草稿");
  const {error}=await adminQuery(service.from("purchase_order_items").insert({clinic_id:member.clinicId,purchase_order_id:orderId,item_id:itemId,quantity,unit_cost:cost}));
  if(error)throw new Error(error.message.includes("duplicate key")?"此品項已在採購單中":adminErrorMessage(error));
  refresh();
}

export async function setPurchaseOrderOrderedAction(fd: FormData): Promise<void> {
  const member=await requireOperator();const {error}=await adminQuery(createServiceClient().from("purchase_orders").update({status:"ordered",ordered_at:new Date().toISOString()}).eq("id",text(fd,"id")).eq("clinic_id",member.clinicId).eq("status","draft"));if(error)throw new Error(adminErrorMessage(error));refresh();
}

export async function receivePurchaseOrderAction(fd: FormData): Promise<void> {
  const member=await requireOperator();const {error}=await adminQuery(createServiceClient().rpc("receive_purchase_order",{p_clinic_id:member.clinicId,p_actor_user_id:member.user.id,p_purchase_order_id:text(fd,"id")}));if(error)throw new Error(adminErrorMessage(error));refresh();
}

export async function finalizeStocktakeAction(fd: FormData): Promise<void> {
  const member=await requireOperator();const counts:Array<{item_id:string;actual_quantity:number}>=[];
  for(const [key,value] of fd.entries()){if(!key.startsWith("count:"))continue;const actual=Number(String(value));if(!Number.isFinite(actual)||actual<0)throw new Error("盤點數量不可小於 0");counts.push({item_id:key.slice(6),actual_quantity:actual});}
  const {error}=await adminQuery(createServiceClient().rpc("finalize_inventory_stocktake",{p_clinic_id:member.clinicId,p_actor_user_id:member.user.id,p_note:text(fd,"note")||null,p_counts:counts}));if(error)throw new Error(adminErrorMessage(error));refresh();
}
