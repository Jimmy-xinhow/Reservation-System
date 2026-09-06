"use server";

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireBrandAdmin } from "@/lib/admin";
import { isBrandPageTemplate, type BrandPageContent } from "@/lib/brand-page";
import { createServiceClient } from "@/lib/supabase";

function str(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

function bool(fd: FormData, key: string): boolean {
  const value = fd.get(key);
  return value === "on" || value === "true" || value === "1";
}

function intOr(fd: FormData, key: string, fallback: number): number {
  const value = Number(str(fd, key));
  return Number.isFinite(value) ? value : fallback;
}

/** 品牌管理者可自行設定 Email；API key 只會送往 Supabase Vault，不會回傳前端。 */
export async function updateEmailSettingsAction(fd: FormData) {
  const { user, clinicId } = await requireBrandAdmin();
  const apiKey = str(fd, "resend_api_key");
  const fromAddress = str(fd, "email_from");
  if (apiKey && !/^re_[A-Za-z0-9_-]{8,250}$/.test(apiKey)) {
    throw new Error("Resend API key 格式不正確，應以 re_ 開頭");
  }
  if (fromAddress && (
    fromAddress.length > 320 ||
    /[\r\n]/.test(fromAddress) ||
    !/^[^<>]*<?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>?$/.test(fromAddress)
  )) {
    throw new Error("寄件者格式不正確，例如 品牌名稱 <booking@example.com>");
  }
  const service = createServiceClient();
  const { data: existing, error: existingError } = await service
    .from("clinic_email_secret_refs")
    .select("clinic_id")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing && Boolean(apiKey) !== Boolean(fromAddress)) {
    throw new Error("第一次設定時，寄件者與 Resend API key 都必須填寫");
  }

  const { error } = await service.rpc("save_clinic_email_configuration", {
    p_clinic_id: clinicId,
    p_actor_user_id: user.id,
    p_enabled: bool(fd, "email_enabled"),
    p_api_key: apiKey || null,
    p_from_address: fromAddress || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/channels");
}

/** 品牌管理者可自行更新金流設定；密鑰只會送往 Supabase Vault，不會回傳到前端。 */
export async function updatePaymentSettingsAction(fd: FormData) {
  const { user, clinicId } = await requireBrandAdmin();
  const provider = str(fd, "provider");
  if (provider !== "ecpay" && provider !== "newebpay") throw new Error("金流商錯誤");
  const environment = str(fd, "environment") === "production" ? "production" : "test";
  const merchantId = str(fd, "merchant_id");
  if (!merchantId) throw new Error("請填寫金流服務提供的商店代號（Merchant ID）");
  const hashKey = str(fd, "hash_key");
  const hashIv = str(fd, "hash_iv");
  if (Boolean(hashKey) !== Boolean(hashIv)) throw new Error("HashKey 與 HashIV 必須一起填寫；若不更換，兩欄都留空");
  if (hashKey) {
    const expectedHashKeyLength = provider === "ecpay" ? 16 : 32;
    if (hashKey.length !== expectedHashKeyLength || hashIv.length !== 16) {
      throw new Error(`${provider === "ecpay" ? "綠界" : "藍新"}的 HashKey 必須是 ${expectedHashKeyLength} 碼，HashIV 必須是 16 碼`);
    }
  }

  const { error } = await createServiceClient().rpc("save_clinic_payment_configuration", {
    p_clinic_id: clinicId,
    p_actor_user_id: user.id,
    p_provider: provider,
    p_merchant_id: merchantId,
    p_environment: environment,
    p_active: bool(fd, "active"),
    p_hash_key: hashKey || null,
    p_hash_iv: hashIv || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/channels");
}

export async function addClinicDomainAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const hostname = str(fd, "hostname").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  if (!hostname || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
    redirect(`/admin/settings?section=domain&err=${encodeURIComponent("請填寫正確網域名稱，例如 booking.example.com")}`);
  }
  const verificationToken = `booking-domain-${randomBytes(12).toString("hex")}`;
  const { error } = await supabase.from("clinic_domains").insert({
    clinic_id: clinicId,
    hostname,
    kind: "custom",
    verification_token: verificationToken,
    active: false,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

export async function verifyClinicDomainAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { data: domain } = await supabase
    .from("clinic_domains")
    .select("id, hostname, verification_token")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!domain?.verification_token) throw new Error("找不到待驗證網域");

  let records: string[][] = [];
  try {
    records = await resolveTxt(`_booking-verification.${domain.hostname}`);
  } catch {
    throw new Error("尚未查到 DNS TXT 驗證紀錄");
  }
  if (!records.flat().includes(domain.verification_token)) throw new Error("DNS TXT 驗證值不一致");

  const { error } = await supabase
    .from("clinic_domains")
    .update({ verified_at: new Date().toISOString(), active: true })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

export async function updateClinicProfileAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const name = str(fd, "name");
  if (!name) throw new Error("請填品牌名稱");
  let lineId = str(fd, "line_basic_id");
  if (lineId && !lineId.startsWith("@")) lineId = `@${lineId}`;
  const slug = str(fd, "slug").toLowerCase();
  if (slug && !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) {
    throw new Error("品牌短網址只能使用英數字與連字號");
  }
  const { error } = await supabase
    .from("clinics")
    .update({
      name,
      slug: slug || null,
      line_basic_id: lineId || null,
      phone: str(fd, "phone") || null,
      address: str(fd, "address") || null,
      intro: str(fd, "intro") || null,
    })
    .eq("id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
  revalidatePath("/");
}

function brandPageText(fd: FormData, key: keyof BrandPageContent, maxLength: number, required = true): string {
  const value = str(fd, key);
  if (required && !value) throw new Error(`請填寫${key}`);
  if (value.length > maxLength) throw new Error(`${key} 內容過長`);
  return value;
}

function safeBrandImageUrl(value: string, label: string): string {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}必須是網站內路徑或 HTTPS 圖片網址`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label}只接受 HTTPS 圖片網址`);
  if (parsed.username || parsed.password) throw new Error(`${label}不可包含帳號或密碼`);
  return parsed.toString();
}

function brandPageImageUrl(fd: FormData, key: "hero_image_url" | "detail_image_url" | "gallery_image_url"): string {
  const labels = { hero_image_url: "主視覺圖片", detail_image_url: "第二區塊圖片", gallery_image_url: "補充情境圖片" } as const;
  return safeBrandImageUrl(brandPageText(fd, key, 1000), labels[key]);
}

export async function updateBrandPageAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const rawTemplate = str(fd, "brand_page_template");
  if (!isBrandPageTemplate(rawTemplate)) throw new Error("品牌形象頁模板不存在");
  const rawPrimaryEntry = str(fd, "primary_entry");
  if (!["auto", "booking", "registration"].includes(rawPrimaryEntry)) throw new Error("主要入口設定不正確");

  const content: BrandPageContent = {
    primary_entry: rawPrimaryEntry as BrandPageContent["primary_entry"],
    hero_eyebrow: brandPageText(fd, "hero_eyebrow", 80),
    hero_title: brandPageText(fd, "hero_title", 120),
    hero_highlight: brandPageText(fd, "hero_highlight", 120),
    hero_description: brandPageText(fd, "hero_description", 500),
    primary_cta_label: brandPageText(fd, "primary_cta_label", 40),
    secondary_cta_label: brandPageText(fd, "secondary_cta_label", 40, false),
    section_title: brandPageText(fd, "section_title", 160),
    section_description: brandPageText(fd, "section_description", 500),
    about_title: brandPageText(fd, "about_title", 160),
    about_description: brandPageText(fd, "about_description", 600),
    trust_point_1: brandPageText(fd, "trust_point_1", 80),
    trust_point_2: brandPageText(fd, "trust_point_2", 80),
    trust_point_3: brandPageText(fd, "trust_point_3", 80),
    faq_1_question: brandPageText(fd, "faq_1_question", 160),
    faq_1_answer: brandPageText(fd, "faq_1_answer", 600),
    faq_2_question: brandPageText(fd, "faq_2_question", 160),
    faq_2_answer: brandPageText(fd, "faq_2_answer", 600),
    hero_image_url: brandPageImageUrl(fd, "hero_image_url"),
    detail_image_url: brandPageImageUrl(fd, "detail_image_url"),
    gallery_image_url: brandPageImageUrl(fd, "gallery_image_url"),
  };
  const rawLogoUrl = str(fd, "brand_logo_url");
  if (rawLogoUrl.length > 1000) throw new Error("品牌 Logo 網址過長");
  const logoUrl = rawLogoUrl ? safeBrandImageUrl(rawLogoUrl, "品牌 Logo") : null;

  const { error } = await supabase
    .from("clinic_settings")
    .update({
      brand_page_enabled: bool(fd, "brand_page_enabled"),
      brand_page_template: rawTemplate,
      brand_page_content: content,
      brand_logo_url: logoUrl,
    })
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePath("/");
  redirect("/admin/settings?section=page&brand_page_saved=1");
}

export async function updateSettingsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const bookingMode = str(fd, "booking_mode") === "number" ? "number" : "time";
  const depositScope = (["all", "self_pay", "none"] as const).includes(
    str(fd, "deposit_scope") as "all" | "self_pay" | "none",
  )
    ? str(fd, "deposit_scope")
    : "self_pay";
  const eventsEnabled = bool(fd, "events_enabled");

  const { error } = await supabase
    .from("clinic_settings")
    .update({
      booking_mode: bookingMode,
      first_visit_extends: bool(fd, "first_visit_extends"),
      first_visit_minutes: str(fd, "first_visit_minutes") ? intOr(fd, "first_visit_minutes", 0) : null,
      allow_multi_patient_per_phone: bool(fd, "allow_multi_patient_per_phone"),
      max_patients_per_phone: Math.max(1, intOr(fd, "max_patients_per_phone", 1)),
      deposit_enabled: bool(fd, "deposit_enabled"),
      deposit_amount: Math.max(0, intOr(fd, "deposit_amount", 0)),
      deposit_scope: depositScope,
      min_lead_minutes: Math.max(0, intOr(fd, "min_lead_minutes", 30)),
      max_advance_days: Math.max(1, intOr(fd, "max_advance_days", 30)),
      recurring_booking_enabled: bool(fd, "recurring_booking_enabled"),
      max_recurring_occurrences: Math.max(2, Math.min(12, intOr(fd, "max_recurring_occurrences", 8))),
      cancel_lead_minutes: Math.max(0, intOr(fd, "cancel_lead_minutes", 120)),
      reschedule_lead_minutes: Math.max(0, intOr(fd, "reschedule_lead_minutes", 120)),
      public_booking_enabled: bool(fd, "public_booking_enabled"),
      events_enabled: eventsEnabled,
      memberships_enabled: bool(fd, "memberships_enabled"),
      crm_automation_enabled: bool(fd, "crm_automation_enabled"),
      beauty_operations_enabled: bool(fd, "beauty_operations_enabled"),
      public_registration_enabled: eventsEnabled && bool(fd, "public_registration_enabled"),
    })
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}
