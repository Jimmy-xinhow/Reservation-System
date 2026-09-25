import { writeFileSync } from "node:fs";

const base = process.env.STAGING_APP_URL ?? "https://reservation-system-staging-staging.up.railway.app";
const url = new URL("/api/membership/portal?clinic_slug=staging-test", base);
if (url.origin !== "https://reservation-system-staging-staging.up.railway.app") {
  throw new Error("Only the configured staging host is allowed");
}

const results = [];
for (let index = 0; index < 12; index += 1) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${index + 10}`,
      "x-real-ip": `203.0.113.${index + 10}`,
    },
    body: "{}",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  results.push({ sequence: index + 1, status: response.status, retryAfter: response.headers.get("retry-after") });
}

const passed = results.every((row, index) => index < 8
  ? row.status === 403
  : row.status === 429 && Number(row.retryAfter) > 0);
const evidence = { auditedAt: new Date().toISOString(), endpoint: url.pathname, expected: "8x403 then 4x429 despite changed forwarding headers", passed, results };
writeFileSync(new URL("../docs/g3-03-rate-source-live-2026-09-24.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ passed, statuses: results.map((row) => row.status), retryAfter: results.slice(8).map((row) => row.retryAfter) }));
if (!passed) process.exitCode = 1;
