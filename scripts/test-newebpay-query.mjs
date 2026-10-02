import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("lib/newebpay-query.ts", "utf8").replace('import "server-only";', "");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { queryPaidNewebpayOrder } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const settings = { provider: "newebpay", environment: "test", merchant_id: "TESTMERCHANT",
  hash_key: "a".repeat(32), hash_iv: "b".repeat(16) };
const merchantOrderNo = "REG_TEST1234";
const detail = { MerchantID: settings.merchant_id, MerchantOrderNo: merchantOrderNo,
  Amt: 100, TradeNo: "1234567890", TradeStatus: "1" };
const checkCode = createHash("sha256").update(
  `HashIV=${settings.hash_iv}&Amt=${detail.Amt}&MerchantID=${detail.MerchantID}&MerchantOrderNo=${detail.MerchantOrderNo}&TradeNo=${detail.TradeNo}&HashKey=${settings.hash_key}`,
).digest("hex").toUpperCase();

test("official single-order query accepts paid only with matching merchant, amount and CheckCode", async () => {
  const prior = globalThis.fetch;
  const responses = [
    { Status: "SUCCESS", Result: { ...detail, CheckCode: checkCode } },
    { Status: "SUCCESS", Result: { ...detail, CheckCode: "0".repeat(64) } },
    { Status: "SUCCESS", Result: { ...detail, Amt: 101, CheckCode: checkCode } },
    { Status: "SUCCESS", Result: { ...detail, TradeStatus: "0", CheckCode: checkCode } },
  ];
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://ccore.newebpay.com/API/QueryTradeInfo");
      assert.equal(options.method, "POST");
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("MerchantOrderNo"), merchantOrderNo);
      assert.equal(body.get("Amt"), "100");
      return { ok: true, json: async () => responses.shift() };
    };
    const verified = await queryPaidNewebpayOrder(settings, merchantOrderNo, 100);
    assert.equal(verified?.tradeNo, detail.TradeNo);
    assert.equal(verified?.payload.Result.MerchantOrderNo, merchantOrderNo);
    assert.equal(await queryPaidNewebpayOrder(settings, merchantOrderNo, 100), null);
    assert.equal(await queryPaidNewebpayOrder(settings, merchantOrderNo, 100), null);
    assert.equal(await queryPaidNewebpayOrder(settings, merchantOrderNo, 100), null);
  } finally {
    globalThis.fetch = prior;
  }
});
