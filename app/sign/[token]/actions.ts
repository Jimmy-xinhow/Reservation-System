"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }

export async function signCustomerDocumentAction(fd: FormData): Promise<void> {
  const token = text(fd, "token");
  const signerName = text(fd, "signer_name");
  if (!token || !signerName || text(fd, "accepted") !== "yes") throw new Error("請填寫簽署姓名並勾選同意");
  const hash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await createServiceClient().from("customer_document_requests").update({
    status: "signed",
    signer_name: signerName.slice(0, 100),
    signature_text: `本人 ${signerName.slice(0, 100)} 已閱讀並同意本文件內容`,
    signed_at: new Date().toISOString(),
  }).eq("token_hash", hash).eq("status", "pending").gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("簽署連結已失效、已使用或已取消");
  redirect(`/sign/${encodeURIComponent(token)}?completed=1`);
}
