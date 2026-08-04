import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function getEncryptionKey() {
  const configured = process.env.DOCUMENT_SYNC_ENCRYPTION_KEY;
  if (!configured) throw new Error("Document encryption is not configured.");

  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error("Document encryption key must be 32 bytes encoded as base64.");
  }
  return key;
}

export function encryptDocumentSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptDocumentSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored document credential is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

type OAuthState = {
  organizationId: string;
  userId: string;
  issuedAt: number;
  nonce: string;
};

export function createDocumentOAuthState(organizationId: string, userId: string) {
  const state: OAuthState = {
    organizationId,
    userId,
    issuedAt: Date.now(),
    nonce: randomBytes(18).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", getEncryptionKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function readDocumentOAuthState(value: string): OAuthState | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", getEncryptionKey()).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (
      !state.organizationId ||
      !state.userId ||
      !state.nonce ||
      Date.now() - state.issuedAt > 15 * 60 * 1_000
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}
