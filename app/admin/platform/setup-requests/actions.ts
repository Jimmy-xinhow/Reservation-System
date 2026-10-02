"use server";

import { revalidatePath } from "next/cache";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";
import { requireSystemPermission } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";

export async function updateBrandSetupRequestAction(fd: FormData): Promise<void> {
  const platform = await requireSystemPermission("brands.manage");
  const id = fd.get("id");
  const status = fd.get("status");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) ||
      typeof status !== "string" || !["in_progress", "ready_for_review"].includes(status)) {
    throw new Error("需求狀態資料不正確。");
  }
  const { data, error } = await adminQuery(createServiceClient().from("brand_setup_requests")
    .update({ status, handled_by: platform.user.id, handled_at: new Date().toISOString() })
    .eq("id", id).select("id").maybeSingle());
  if (error) throw new Error(adminErrorMessage(error));
  if (!data) throw new Error("找不到這筆代設定需求，請重新整理後確認。");
  revalidatePath("/admin/platform/setup-requests");
  revalidatePath("/admin/setup-request");
}
