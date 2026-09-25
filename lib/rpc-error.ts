import "server-only";
import { fail } from "@/lib/http";

// Only exact, known database business exceptions may become client-facing conflicts.
const BUSINESS_MESSAGES = {
  patient: {
    "name and phone are required": "請填寫姓名與電話",
    "patient identity is too long": "顧客資料長度不正確",
    "patient is bound to another LINE account": "此顧客資料已綁定其他 LINE 帳號，請確認姓名、電話與生日",
    "phone already has a patient": "此電話已登記其他顧客，請洽服務人員",
    "phone patient limit reached": "此電話可登記人數已達上限",
  },
  checkin: {
    "缺少報到憑證": "缺少報到憑證",
    "報到憑證無效": "報到憑證無效",
    "此報名目前不可報到": "此報名目前不可報到",
    "報到憑證已過期，活動場次已結束": "報到憑證已過期，活動場次已結束",
  },
  cancel: {
    "缺少取消憑證": "缺少取消憑證",
    "取消憑證無效": "取消憑證無效",
    "registration customer does not match": "找不到此顧客的報名資料",
    "registration not found": "找不到報名資料",
  },
} as const;

export function rpcFailure(error: unknown, operation: keyof typeof BUSINESS_MESSAGES) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof record.message === "string" ? record.message : "";
  const messages: Readonly<Record<string, string>> = BUSINESS_MESSAGES[operation];
  if (record.code === "P0001" && Object.prototype.hasOwnProperty.call(messages, message)) {
    return fail(messages[message], 409);
  }
  return fail(message, 500);
}
