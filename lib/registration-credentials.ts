import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer | null {
  const raw = process.env.REGISTRATION_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 32) return null;
  return createHash("sha256").update(raw, "utf8").digest();
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function encryptRegistrationToken(token: string): string | null {
  const key = encryptionKey();
  if (!key || !token) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, encode(iv), encode(cipher.getAuthTag()), encode(ciphertext)].join(".");
}

export function decryptRegistrationToken(envelope: string | null | undefined): string | null {
  const key = encryptionKey();
  if (!key || !envelope) return null;
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, decode(parts[1]));
    decipher.setAuthTag(decode(parts[2]));
    return Buffer.concat([decipher.update(decode(parts[3])), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
