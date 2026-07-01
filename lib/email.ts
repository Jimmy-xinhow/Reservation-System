// Email 提醒(可選)。設定值改由後台存於 clinic_settings,cron 讀取後傳入。
// Resend 免費方案每月約 3,000 封。

export interface EmailConfig {
  apiKey: string;
  from: string;
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
