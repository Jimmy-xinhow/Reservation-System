import "server-only";
import { errorCategory } from "@/lib/error-category";

const UNCONFIRMED = "目前無法確認操作結果，請重新載入查看資料，避免重複送出";

/** Keep database details out of framework logs; business-specific mappings stay at the call site. */
export function adminErrorMessage(error: unknown): string {
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  return `${UNCONFIRMED}（${errorCategory(message)}）`;
}

/** Catch rejected queries without swallowing returned error codes used for business validation. */
export async function adminQuery<T>(query: PromiseLike<T>): Promise<T> {
  try {
    return await query;
  } catch (error) {
    throw new Error(adminErrorMessage(error));
  }
}
