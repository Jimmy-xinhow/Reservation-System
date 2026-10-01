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
  fd.set("simultaneousBookings", "2");
  fd.set("pricingSummary", "服務 60 分鐘 NT$800");
  fd.set("depositAmount", "100");
  fd.append("channels", "line");
  fd.append("channels", "browser");
  return fd;
}

test("brand intake accepts a scoped service plan", () => {
  const answer = parseBrandSetupAnswers(validForm());
  assert.equal(answer.goal, "both");
  assert.deepEqual(answer.channels, ["line", "browser"]);
  assert.equal(answer.payment, "newebpay");
  assert.equal(answer.simultaneousBookings, 2);
  assert.equal(answer.pricingSummary, "服務 60 分鐘 NT$800");
  assert.equal(answer.depositAmount, 100);
});

test("brand intake keeps undecided capacity and pricing explicit", () => {
  const fd = validForm();
  fd.delete("simultaneousBookings");
  fd.delete("pricingSummary");
  fd.delete("depositAmount");
  const answer = parseBrandSetupAnswers(fd);
  assert.equal(answer.simultaneousBookings, null);
  assert.equal(answer.pricingSummary, "");
  assert.equal(answer.depositAmount, null);
});

test("brand intake rejects invalid capacity, deposit, and contradictory payment", () => {
  for (const [field, value] of [["simultaneousBookings", "0"], ["simultaneousBookings", "1.5"], ["depositAmount", "-1"], ["depositAmount", "1.5"]]) {
    const fd = validForm();
    fd.set(field, value);
    assert.throws(() => parseBrandSetupAnswers(fd));
  }
  const noGateway = validForm();
  noGateway.set("payment", "none");
  assert.throws(() => parseBrandSetupAnswers(noGateway));
  noGateway.set("depositAmount", "0");
  assert.equal(parseBrandSetupAnswers(noGateway).depositAmount, 0);
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
