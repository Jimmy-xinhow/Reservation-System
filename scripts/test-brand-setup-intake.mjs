import assert from "node:assert/strict";
import test from "node:test";
import { parseBrandSetupAnswers } from "../lib/brand-setup-intake.ts";

function validForm() {
  const fd = new FormData();
  fd.set("goal", "both");
  fd.set("bookingMode", "time");
  fd.set("assignment", "optional");
  fd.set("payment", "newebpay");
  fd.set("serviceSummary", "服務 60 分鐘");
  fd.append("channels", "line");
  fd.append("channels", "browser");
  return fd;
}

test("brand intake accepts a scoped service plan", () => {
  const answer = parseBrandSetupAnswers(validForm());
  assert.equal(answer.goal, "both");
  assert.deepEqual(answer.channels, ["line", "browser"]);
  assert.equal(answer.payment, "newebpay");
});

test("brand intake rejects forged choices and duplicate fields", () => {
  const forged = validForm();
  forged.set("payment", "stripe");
  assert.throws(() => parseBrandSetupAnswers(forged));
  const duplicate = validForm();
  duplicate.append("goal", "registration");
  assert.throws(() => parseBrandSetupAnswers(duplicate));
});

test("brand intake rejects oversized notes and non-text input", () => {
  const oversized = validForm();
  oversized.set("additionalNeeds", "a".repeat(501));
  assert.throws(() => parseBrandSetupAnswers(oversized));
  const file = validForm();
  file.set("serviceSummary", new File(["a"], "secret.txt"));
  assert.throws(() => parseBrandSetupAnswers(file));
});
