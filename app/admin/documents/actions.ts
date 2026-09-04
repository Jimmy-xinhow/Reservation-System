"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createDocumentTemplateAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const name = text(fd, "name");
  const kind = text(fd, "kind");
  const body = text(fd, "body");
  if (!name || !body || !["consent", "waiver", "intake"].includes(kind)) throw new Error("請填寫完整範本內容");
  const { error } = await createServiceClient().from("document_templates").insert({
    clinic_id: member.clinicId,
    name: name.slice(0, 160),
    kind,
    body: body.slice(0, 20000),
    version: 1,
    active: true,
    created_by: member.user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/documents");
}

export async function issueDocumentRequestAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const service = createServiceClient();
  const patientId = text(fd, "patient_id");
  const templateId = text(fd, "template_id");
  const expiresInDays = Math.max(1, Math.min(30, Number.parseInt(text(fd, "expires_in_days"), 10) || 7));
  const [{ data: patient }, { data: template }] = await Promise.all([
    service.from("patients").select("id").eq("id", patientId).eq("clinic_id", member.clinicId).eq("active", true).maybeSingle(),
    service.from("document_templates").select("id,body,version").eq("id", templateId).eq("clinic_id", member.clinicId).eq("active", true).maybeSingle(),
  ]);
  if (!patient || !template) throw new Error("顧客或文件範本不屬於目前品牌");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  const { data, error } = await service.from("customer_document_requests").insert({
    clinic_id: member.clinicId,
    patient_id: patientId,
    template_id: templateId,
    token_hash: tokenHash(token),
    content_snapshot: template.body,
    template_version: template.version,
    expires_at: expiresAt,
    status: "pending",
    created_by: member.user.id,
  }).select("id").single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/documents");
  redirect(`/admin/documents?request_id=${encodeURIComponent(data.id)}&sign_token=${encodeURIComponent(token)}`);
}

export async function cancelDocumentRequestAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const { error } = await createServiceClient().from("customer_document_requests").update({ status: "cancelled" }).eq("id", text(fd, "id")).eq("clinic_id", member.clinicId).eq("status", "pending");
  if (error) throw new Error(error.message);
  revalidatePath("/admin/documents");
}
