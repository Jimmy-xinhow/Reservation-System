import "server-only";

import { createHash, createCipheriv, createDecipheriv, timingSafeEqual, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PaymentProvider = "ecpay" | "newebpay";
export type PaymentEnvironment = "test" | "production";

export interface PaymentSettings {
  clinic_id: string;
  provider: PaymentProvider;
  merchant_id: string;
  hash_key: string | null;
  hash_iv: string | null;
  environment: PaymentEnvironment;
  active: boolean;
}

export interface PaymentForm {
  action: string;
  fields: Record<string, string>;
}

interface PaymentSecret {
  hashKey: string;
  hashIv: string;
}

function paymentSecretMap(): Record<string, PaymentSecret> {
  const raw = process.env.PAYMENT_SECRETS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, PaymentSecret] => {
        const value = entry[1];
        return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
          typeof (value as Record<string, unknown>).hashKey === "string" &&
          typeof (value as Record<string, unknown>).hashIv === "string";
      }),
    );
  } catch {
    return {};
  }
}

export function paymentSecretsForClinic(clinicId: string): PaymentSecret | null {
  const secret = paymentSecretMap()[clinicId];
  return secret?.hashKey && secret.hashIv ? secret : null;
}

const ECPAY_TEST = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
const ECPAY_PRODUCTION = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
const NEWEBPAY_TEST = "https://ccore.newebpay.com/MPG/mpg_gateway";
const NEWEBPAY_PRODUCTION = "https://core.newebpay.com/MPG/mpg_gateway";

export function paymentAction(provider: PaymentProvider, environment: PaymentEnvironment): string {
  if (provider === "ecpay") return environment === "production" ? ECPAY_PRODUCTION : ECPAY_TEST;
  return environment === "production" ? NEWEBPAY_PRODUCTION : NEWEBPAY_TEST;
}

export async function getPaymentSettings(supabase: SupabaseClient, clinicId: string): Promise<PaymentSettings | null> {
  const { data, error } = await supabase
    .from("clinic_payment_settings")
    .select("clinic_id, provider, merchant_id, environment, active")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return withPaymentSecrets(data as Omit<PaymentSettings, "hash_key" | "hash_iv">);
}

export async function getPaymentSettingsByMerchant(
  supabase: SupabaseClient,
  provider: PaymentProvider,
  merchantId: string,
): Promise<PaymentSettings | null> {
  const { data, error } = await supabase
    .from("clinic_payment_settings")
    .select("clinic_id, provider, merchant_id, environment, active")
    .eq("provider", provider)
    .eq("merchant_id", merchantId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return withPaymentSecrets(data as Omit<PaymentSettings, "hash_key" | "hash_iv">);
}

function withPaymentSecrets(data: Omit<PaymentSettings, "hash_key" | "hash_iv">): PaymentSettings {
  const secret = paymentSecretsForClinic(data.clinic_id);
  return { ...data, hash_key: secret?.hashKey ?? null, hash_iv: secret?.hashIv ?? null };
}

export function createMerchantOrderNo(prefix: "REG" | "APT" = "REG"): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}${stamp}${suffix}`.slice(0, 20);
}

function ecpayEncode(value: string): string {
  return encodeURIComponent(value)
    .toLowerCase()
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%20/g, "+");
}

function ecpayCheckMac(fields: Record<string, string>, hashKey: string, hashIv: string): string {
  const content = Object.entries(fields)
    .filter(([key, value]) => key.toLowerCase() !== "checkmacvalue" && value !== "")
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("md5")
    .update(ecpayEncode(`HashKey=${hashKey}&${content}&HashIV=${hashIv}`))
    .digest("hex")
    .toUpperCase();
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().toUpperCase());
  const right = Buffer.from(b.trim().toUpperCase());
  return left.length === right.length && timingSafeEqual(left, right);
}

function taipeiPaymentTimestamp(): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .replace(/\//g, "-")
    .replace(", ", " ");
}

export function createEcpayForm(args: {
  settings: PaymentSettings;
  merchantOrderNo: string;
  amount: number;
  itemName: string;
  returnUrl: string;
  notifyUrl: string;
  clientBackUrl: string;
}): PaymentForm {
  if (!args.settings.hash_key || !args.settings.hash_iv) throw new Error("綠界尚未設定 HashKey / HashIV");
  const fields: Record<string, string> = {
    MerchantID: args.settings.merchant_id,
    MerchantTradeNo: args.merchantOrderNo,
    MerchantTradeDate: taipeiPaymentTimestamp(),
    PaymentType: "aio",
    TotalAmount: String(args.amount),
    TradeDesc: "Booking SaaS",
    ItemName: args.itemName.slice(0, 200),
    ReturnURL: args.notifyUrl,
    ClientBackURL: args.clientBackUrl,
    ChoosePayment: "Credit",
    EncryptType: "1",
    OrderResultURL: args.returnUrl,
  };
  return {
    action: paymentAction("ecpay", args.settings.environment),
    fields: { ...fields, CheckMacValue: ecpayCheckMac(fields, args.settings.hash_key, args.settings.hash_iv) },
  };
}

export function verifyEcpay(fields: Record<string, string>, settings: PaymentSettings): boolean {
  if (!settings.hash_key || !settings.hash_iv || !fields.CheckMacValue) return false;
  return safeCompare(fields.CheckMacValue, ecpayCheckMac(fields, settings.hash_key, settings.hash_iv));
}

function encryptNewebpay(value: string, hashKey: string, hashIv: string): string {
  validateNewebpayKeyMaterial(hashKey, hashIv);
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIv, "utf8"));
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("hex");
}

function decryptNewebpay(value: string, hashKey: string, hashIv: string): string {
  validateNewebpayKeyMaterial(hashKey, hashIv);
  const decipher = createDecipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIv, "utf8"));
  return Buffer.concat([decipher.update(Buffer.from(value, "hex")), decipher.final()]).toString("utf8");
}

function validateNewebpayKeyMaterial(hashKey: string, hashIv: string): void {
  if (Buffer.byteLength(hashKey, "utf8") !== 32 || Buffer.byteLength(hashIv, "utf8") !== 16) {
    throw new Error("藍新 HashKey 必須 32 bytes、HashIV 必須 16 bytes");
  }
}

export function createNewebpayForm(args: {
  settings: PaymentSettings;
  merchantOrderNo: string;
  amount: number;
  itemName: string;
  returnUrl: string;
  notifyUrl: string;
  clientBackUrl: string;
}): PaymentForm {
  if (!args.settings.hash_key || !args.settings.hash_iv) throw new Error("藍新尚未設定 HashKey / HashIV");
  const tradeInfo = new URLSearchParams({
    MerchantID: args.settings.merchant_id,
    RespondType: "JSON",
    TimeStamp: String(Math.floor(Date.now() / 1000)),
    Version: "2.0",
    MerchantOrderNo: args.merchantOrderNo,
    Amt: String(args.amount),
    ItemDesc: args.itemName.slice(0, 200),
    ReturnURL: args.returnUrl,
    NotifyURL: args.notifyUrl,
    ClientBackURL: args.clientBackUrl,
  }).toString();
  const encrypted = encryptNewebpay(tradeInfo, args.settings.hash_key, args.settings.hash_iv);
  const tradeSha = createHash("sha256")
    .update(`HashKey=${args.settings.hash_key}&TradeInfo=${encrypted}&HashIV=${args.settings.hash_iv}`)
    .digest("hex")
    .toUpperCase();
  return {
    action: paymentAction("newebpay", args.settings.environment),
    fields: { MerchantID: args.settings.merchant_id, TradeInfo: encrypted, TradeSha: tradeSha, Version: "2.0" },
  };
}

export function decryptAndVerifyNewebpay(
  fields: Record<string, string>,
  settings: PaymentSettings,
): Record<string, unknown> {
  if (!settings.hash_key || !settings.hash_iv || !fields.TradeInfo || !fields.TradeSha) throw new Error("藍新回呼缺少驗證欄位");
  const expected = createHash("sha256")
    .update(`HashKey=${settings.hash_key}&TradeInfo=${fields.TradeInfo}&HashIV=${settings.hash_iv}`)
    .digest("hex")
    .toUpperCase();
  if (!safeCompare(fields.TradeSha, expected)) throw new Error("藍新 TradeSha 驗證失敗");
  const parsed = JSON.parse(decryptNewebpay(fields.TradeInfo, settings.hash_key, settings.hash_iv)) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("藍新回呼內容格式錯誤");
  return parsed as Record<string, unknown>;
}

export function asPaymentFormFields(value: FormData | URLSearchParams): Record<string, string> {
  const fields: Record<string, string> = {};
  value.forEach((item, key) => {
    fields[key] = typeof item === "string" ? item : item.name;
  });
  return fields;
}
