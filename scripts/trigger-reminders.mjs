// Railway「cron 服務」用的一次性腳本:
//   打 web 服務的 /api/cron/reminders(帶 CRON_SECRET),完成即退出。
// 需要的環境變數:
//   APP_URL      web 服務的公開網址,例如 https://your-app.up.railway.app
//                (或直接給 CRON_TARGET_URL 指定完整 endpoint URL)
//   CRON_SECRET  與 web 服務相同的密鑰
//
// 退出碼:成功 0、失敗 1(方便在 Railway 觀察 cron 是否正常)。

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("[reminders] 缺少 CRON_SECRET");
  process.exit(1);
}

const target =
  process.env.CRON_TARGET_URL ||
  (process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, "")}/api/cron/reminders`
    : null);

if (!target) {
  console.error("[reminders] 缺少 APP_URL(或 CRON_TARGET_URL)");
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60_000);

try {
  const res = await fetch(target, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
    signal: controller.signal,
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    console.error(`[reminders] 失敗 ${res.status}: ${body}`);
    process.exit(1);
  }
  console.log(`[reminders] 完成 ${res.status}: ${body}`);
  process.exit(0);
} catch (err) {
  console.error(`[reminders] 例外: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
