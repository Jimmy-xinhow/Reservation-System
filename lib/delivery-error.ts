import { errorCategory } from "./error-category";

// Exact, application-owned reasons remain actionable. Provider text is never stored.
const safeReasons = new Set([
  "顧客已停用", "顧客未同意行銷", "顧客沒有 LINE 身分",
  "顧客或品牌尚未完成 Email 設定",
  "LINE Webhook URL 與本環境不符；請核對本頁下方的訊息接收網址。若此官方帳號也供其他環境使用，請勿直接覆蓋其 Webhook。",
]);
const safeCategories = new Set([
  "delivery_error:configuration", "delivery_error:database",
  "delivery_error:connection", "delivery_error:internal",
  "delivery_error:provider_rejected",
]);

export function deliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (safeReasons.has(message)) return message;
  if (safeCategories.has(message)) return message;
  return `delivery_error:${errorCategory(message)}`;
}
