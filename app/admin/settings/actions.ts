"use server";

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { isBrandPageTemplate, type BrandPageContent } from "@/lib/brand-page";

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

/** 只更新品牌是否啟用 Email；寄件憑證仍由伺服器環境變數管理。 */
export async function updateEmailSettingsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const { error } = await supabase
    .from("clinic_settings")
    .update({ email_enabled: bool(fd, "email_enabled") })
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

/** 保存非機密金流識別資料；HashKey／HashIV 等密鑰不得進資料庫。 */
export async function updatePaymentSettingsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const provider = str(fd, "provider");
  if (provider !== "ecpay" && provider !== "newebpay") throw new Error("金流商錯誤");
  const environment = str(fd, "environment") === "production" ? "production" : "test";
  const merchantId = str(fd, "merchant_id");
  if (!merchantId) throw new Error("請填寫金流服務提供的商店代號（Merchant ID）");

  const { error } = await supabase.from("clinic_payment_settings").upsert(
    {
      clinic_id: clinicId,
      provider,
      merchant_id: merchantId,
      environment,
      active: bool(fd, "active"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
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
