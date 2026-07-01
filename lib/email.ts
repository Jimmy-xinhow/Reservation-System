// 免費/低成本 Email 提醒(可選)。設定 RESEND_API_KEY 才啟用。
// Resend 免費方案每月約 3,000 封,足以覆蓋一般診所提醒量。

export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.REMINDER_EMAIL_FROM;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_EMAIL_FROM;
  if (!key || !from) throw new Error("Email 未設定(RESEND_API_KEY / REMINDER_EMAIL_FROM)");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email 寄送失敗 (${res.status}): ${detail}`);
  }
}
