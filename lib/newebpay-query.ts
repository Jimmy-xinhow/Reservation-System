import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentSettings } from "./payment";

interface QueryResult {
  tradeNo: string;
  payload: Record<string, unknown>;
}

function matchingCode(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual.toUpperCase()), Buffer.from(expected));
}

/** NDNF-1.0.8 sections 4.3.1/4.3.2: one exact order, not a general reconciliation job. */
export async function queryPaidNewebpayOrder(
  settings: PaymentSettings,
  merchantOrderNo: string,
  amount: number,
): Promise<QueryResult | null> {
  const key = settings.hash_key;
  const iv = settings.hash_iv;
  if (settings.provider !== "newebpay" || !key || !iv ||
      Buffer.byteLength(key) !== 32 || Buffer.byteLength(iv) !== 16 ||
      !/^[A-Za-z0-9_]{1,30}$/.test(merchantOrderNo) ||
      !Number.isSafeInteger(amount) || amount <= 0) return null;

  const checkValue = createHash("sha256").update(
    `IV=${iv}&Amt=${amount}&MerchantID=${settings.merchant_id}&MerchantOrderNo=${merchantOrderNo}&Key=${key}`,
  ).digest("hex").toUpperCase();
  const endpoint = settings.environment === "production"
    ? "https://core.newebpay.com/API/QueryTradeInfo"
    : "https://ccore.newebpay.com/API/QueryTradeInfo";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      MerchantID: settings.merchant_id,
      Version: "1.3",
      RespondType: "JSON",
      CheckValue: checkValue,
      TimeStamp: String(Math.floor(Date.now() / 1000)),
      MerchantOrderNo: merchantOrderNo,
      Amt: String(amount),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const result = body as Record<string, unknown>;
  const detail = result.Result;
  if (result.Status !== "SUCCESS" || !detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const trade = detail as Record<string, unknown>;
  if (trade.TradeStatus !== "1" || trade.MerchantID !== settings.merchant_id ||
      trade.MerchantOrderNo !== merchantOrderNo || Number(trade.Amt) !== amount ||
      typeof trade.TradeNo !== "string" || !/^[A-Za-z0-9]{1,30}$/.test(trade.TradeNo)) return null;
  const expectedCode = createHash("sha256").update(
    `HashIV=${iv}&Amt=${trade.Amt}&MerchantID=${trade.MerchantID}&MerchantOrderNo=${trade.MerchantOrderNo}&TradeNo=${trade.TradeNo}&HashKey=${key}`,
  ).digest("hex").toUpperCase();
  if (!matchingCode(trade.CheckCode, expectedCode)) return null;

  return {
    tradeNo: trade.TradeNo,
    // Keep only the verified fields; payment persistence writes a normalized receipt.
    payload: { Status: "SUCCESS", Result: {
      MerchantID: settings.merchant_id,
      MerchantOrderNo: merchantOrderNo,
      Amt: amount,
      TradeNo: trade.TradeNo,
      TradeStatus: "1",
    } },
  };
}
