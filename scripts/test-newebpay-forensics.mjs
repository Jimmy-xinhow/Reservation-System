import assert from "node:assert/strict";
import { createDecipheriv, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/newebpay-forensics.ts", import.meta.url), "utf8")
  .replace('import "server-only";', "");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { captureRejectedNewebpayCallback } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  RAILWAY_ENVIRONMENT_NAME: "staging",
  NEWEBPAY_FORENSIC_CAPTURE: "1",
  NEWEBPAY_FORENSIC_CLINIC_ID: "qa-brand",
  NEWEBPAY_FORENSIC_MERCHANT_ID: "TESTMERCHANT",
  NEWEBPAY_FORENSIC_PUBLIC_KEY_SPKI_B64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
};
const settings = {
  clinic_id: "qa-brand", merchant_id: "TESTMERCHANT", environment: "test",
  hash_key: "a".repeat(32), hash_iv: "b".repeat(16),
};
const tradeInfo = "ab".repeat(512);
const fields = {
  MerchantID: settings.merchant_id,
  Status: "SUCCESS",
  Version: "2.0",
  TradeInfo: tradeInfo,
  TradeSha: createHash("sha256")
    .update(`HashKey=${settings.hash_key}&${tradeInfo}&HashIV=${settings.hash_iv}`)
    .digest("hex").toUpperCase(),
};

test("capture is inert outside an explicitly scoped staging test merchant", () => {
  for (const [config, merchant] of [
    [{ ...env, NEWEBPAY_FORENSIC_CAPTURE: "0" }, settings],
    [{ ...env, RAILWAY_ENVIRONMENT_NAME: "production" }, settings],
    [env, { ...settings, clinic_id: "another-brand" }],
    [env, { ...settings, environment: "production" }],
    [env, { ...settings, merchant_id: "ANOTHER" }],
  ]) {
    const logs = [];
    assert.equal(captureRejectedNewebpayCallback(fields, merchant, config, (...args) => logs.push(args)), false);
    assert.equal(logs.length, 0);
  }
});

test("unsigned or malformed ciphertext never reaches encrypted logs", () => {
  for (const invalid of [
    { ...fields, TradeSha: "0".repeat(64) },
    { ...fields, TradeInfo: "not-hex" },
    { ...fields, TradeInfo: "aa".repeat(4097) },
  ]) {
    const logs = [];
    assert.equal(captureRejectedNewebpayCallback(invalid, settings, env, (...args) => logs.push(args)), false);
    assert.equal(logs.length, 0);
  }
});

test("a signed QA callback is recoverable only with the private key and absent from plaintext logs", () => {
  const logs = [];
  assert.equal(captureRejectedNewebpayCallback(fields, settings, env, (...args) => logs.push(args)), true);
  assert.equal(logs.length, 1);
  const [message, envelope] = logs[0];
  assert.equal(message, "NewebPay encrypted forensic capture");
  const exposed = JSON.stringify(logs);
  assert.equal(exposed.includes(tradeInfo), false);
  assert.equal(exposed.includes(settings.hash_key), false);
  assert.equal(exposed.includes(settings.hash_iv), false);

  const key = privateDecrypt({
    key: privateKey,
    oaepHash: "sha256",
  }, Buffer.from(envelope.wrappedKey, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final(),
  ]);
  assert.deepEqual(JSON.parse(decrypted.toString("utf8")), { ...fields, EncryptType: null });
});

test("a bad public key leaves the original callback rejection path usable", () => {
  const logs = [];
  assert.equal(captureRejectedNewebpayCallback(fields, settings, {
    ...env, NEWEBPAY_FORENSIC_PUBLIC_KEY_SPKI_B64: "invalid",
  }, (...args) => logs.push(args)), false);
  assert.deepEqual(logs, [["NewebPay forensic capture unavailable", { reason: "encryption_failed" }]]);
});
