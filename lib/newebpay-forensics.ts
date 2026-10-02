import "server-only";
import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, timingSafeEqual } from "node:crypto";
import type { PaymentSettings } from "@/lib/payment";

type CaptureEnv = NodeJS.ProcessEnv;
type CaptureLog = (message: string, details: Record<string, string | number>) => void;

// Staging-only, opt-in evidence capture for a signed test-merchant callback that
// failed CBC decoding. The private key never exists on the application host.
export function captureRejectedNewebpayCallback(
  fields: Record<string, string>,
  settings: Pick<PaymentSettings, "clinic_id" | "merchant_id" | "environment" | "hash_key" | "hash_iv">,
  env: CaptureEnv = process.env,
  log: CaptureLog = console.warn,
): boolean {
  if (env.RAILWAY_ENVIRONMENT_NAME !== "staging" || env.NEWEBPAY_FORENSIC_CAPTURE !== "1" ||
      settings.environment !== "test" || !env.NEWEBPAY_FORENSIC_CLINIC_ID ||
      !env.NEWEBPAY_FORENSIC_MERCHANT_ID || !env.NEWEBPAY_FORENSIC_PUBLIC_KEY_SPKI_B64 ||
      settings.clinic_id !== env.NEWEBPAY_FORENSIC_CLINIC_ID ||
      settings.merchant_id !== env.NEWEBPAY_FORENSIC_MERCHANT_ID ||
      fields.MerchantID !== settings.merchant_id || !settings.hash_key || !settings.hash_iv) {
    return false;
  }

  const tradeInfo = fields.TradeInfo ?? "";
  const tradeSha = fields.TradeSha ?? "";
  if (!tradeInfo || tradeInfo.length > 8192 || tradeInfo.length % 2 !== 0 ||
      !/^[0-9a-f]+$/i.test(tradeInfo) || !/^[0-9a-f]{64}$/i.test(tradeSha)) return false;
  const expected = createHash("sha256")
    .update(`HashKey=${settings.hash_key}&${tradeInfo}&HashIV=${settings.hash_iv}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(tradeSha, "hex"))) return false;

  const plaintext = Buffer.from(JSON.stringify({
    MerchantID: fields.MerchantID,
    Status: fields.Status ?? null,
    Version: fields.Version ?? null,
    EncryptType: fields.EncryptType ?? null,
    TradeInfo: tradeInfo,
    TradeSha: tradeSha,
  }), "utf8");
  const key = randomBytes(32);
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(env.NEWEBPAY_FORENSIC_PUBLIC_KEY_SPKI_B64, "base64"),
      format: "der",
      type: "spki",
    });
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = publicEncrypt({
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    }, key);
    log("NewebPay encrypted forensic capture", {
      version: 1,
      wrappedKey: wrappedKey.toString("base64url"),
      nonce: nonce.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: encrypted.toString("base64url"),
    });
    return true;
  } catch {
    log("NewebPay forensic capture unavailable", { reason: "encryption_failed" });
    return false;
  } finally {
    plaintext.fill(0);
    key.fill(0);
  }
}
