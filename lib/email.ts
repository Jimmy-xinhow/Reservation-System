// Email 提醒(可選)。設定值改由後台存於 clinic_settings,cron 讀取後傳入。
// Resend 免費方案每月約 3,000 封。

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase";

export interface EmailConfig {
  apiKey: string;
  from: string;
}

export interface EmailCredentialStatus {
  configured: boolean;
  source: "vault" | "environment" | null;
  from: string | null;
}

function envMap(name: "RESEND_API_KEYS_JSON" | "RESEND_EMAIL_FROM_JSON"): Record<string, string> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function isLegacyEmailClinic(clinicId: string): boolean {
  return (process.env.RESEND_LEGACY_CLINIC_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(clinicId);
}

function environmentEmailConfig(clinicId: string): EmailConfig | null {
  const mappedApiKey = envMap("RESEND_API_KEYS_JSON")[clinicId];
  const mappedFrom = envMap("RESEND_EMAIL_FROM_JSON")[clinicId];
  if (mappedApiKey && mappedFrom) return { apiKey: mappedApiKey, from: mappedFrom };
  if (!isLegacyEmailClinic(clinicId)) return null;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_EMAIL_FROM;
  return apiKey && from ? { apiKey, from } : null;
}

/** Resend 金鑰只在 server 端解密；Vault 優先，部署變數作為既有品牌備援。 */
export async function emailConfigForClinic(
  clinicId: string,
  service: SupabaseClient = createServiceClient(),
): Promise<EmailConfig | null> {
  const { data, error } = await service.rpc("get_clinic_email_configuration", {
    p_clinic_id: clinicId,
  });
  if (error) throw new Error(`Email 憑證讀取失敗: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : null) as
    | { api_key?: unknown; from_address?: unknown }
    | null;
  if (typeof row?.api_key === "string" && typeof row?.from_address === "string") {
    return { apiKey: row.api_key, from: row.from_address };
  }

  return environmentEmailConfig(clinicId);
}

/** 僅讀取後台可顯示的設定狀態與寄件者，不解密 API key。 */
export async function getEmailCredentialStatus(
  service: SupabaseClient,
  clinicId: string,
): Promise<EmailCredentialStatus> {
  const { data, error } = await service
    .from("clinic_email_secret_refs")
    .select("api_key_secret_id, from_address")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error(`Email 設定狀態讀取失敗: ${error.message}`);
  if (data?.api_key_secret_id && typeof data.from_address === "string") {
    return { configured: true, source: "vault", from: data.from_address };
  }

  const config = environmentEmailConfig(clinicId);
  return { configured: Boolean(config), source: config ? "environment" : null, from: config?.from ?? null };
}

export async function sendEmail(
  cfg: EmailConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!cfg.apiKey || !cfg.from) throw new Error("Email 未設定");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: cfg.from, to, subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email 寄送失敗 (${res.status}): ${detail}`);
  }
}
