import "server-only";

/** Discard upstream errors (including causes); callers supply only fixed local text. No retries. */
export async function providerOperation<T>(operation: () => PromiseLike<T>, failure: string): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(failure);
  }
}

export function providerFetch(input: string, init?: RequestInit): Promise<Response> {
  return providerOperation(() => fetch(input, init), "外部服務連線失敗 (fetch failed)");
}

export function providerJson(response: Response): Promise<unknown> {
  return providerOperation(() => response.json(), "外部服務回應格式不正確");
}
