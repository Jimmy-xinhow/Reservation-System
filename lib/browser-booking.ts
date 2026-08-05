import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export interface BrowserBookingIdentity {
  clinicId: string;
  patientId: string;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.BROWSER_BOOKING_SECRET;
  if (!value || value.length < 32) throw new Error("請設定 BROWSER_BOOKING_SECRET（至少 32 字元）");
  return value;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createBrowserBookingToken(clinicId: string, patientId: string): string {
  const ttl = Math.max(15 * 60, Number(process.env.BROWSER_BOOKING_TOKEN_TTL_SECONDS ?? 86400) || 86400);
  const payload = encode(JSON.stringify({ clinicId, patientId, expiresAt: Math.floor(Date.now() / 1000) + ttl }));
  return `${payload}.${sign(payload)}`;
}

export function verifyBrowserBookingToken(token: string): BrowserBookingIdentity | null {
  const [payload, signature] = token.trim().split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<BrowserBookingIdentity>;
    if (typeof value.clinicId !== "string" || typeof value.patientId !== "string" || typeof value.expiresAt !== "number") return null;
    if (value.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return { clinicId: value.clinicId, patientId: value.patientId, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}
