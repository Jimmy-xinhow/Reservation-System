// Email 提醒(可選)。設定值改由後台存於 clinic_settings,cron 讀取後傳入。
// Resend 免費方案每月約 3,000 封。

import "server-only";

export interface EmailConfig {
  apiKey: string;
  from: string;
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

/** Resend 金鑰只從 server environment 讀取，禁止由 clinic_settings 提供。 */
export function emailConfigForClinic(clinicId: string): EmailConfig | null {
  const apiKey = envMap("RESEND_API_KEYS_JSON")[clinicId] ?? process.env.RESEND_API_KEY;
  const from = envMap("RESEND_EMAIL_FROM_JSON")[clinicId] ?? process.env.RESEND_EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
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
