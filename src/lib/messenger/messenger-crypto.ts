import crypto from "crypto";

export type EncryptedSecretPayload = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
};

const SECRET_KEY_SOURCES = [
  "MESSENGER_CREDENTIAL_ENCRYPTION_KEY",
  "TELEGRAM_SESSION_ENCRYPTION_KEY",
  "MESSENGER_SETTINGS_SECRET",
  "SESSION_SECRET",
  "AUTH_SALT",
] as const;

function baseSecret() {
  for (const key of SECRET_KEY_SOURCES) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("В production не настроен master-key шифрования интеграций");
  }
  return "eco-messenger-dev-secret-change-in-production";
}

function encryptionKey() {
  return crypto.createHash("sha256").update(baseSecret(), "utf8").digest();
}

export function encryptIntegrationSecret(value: string): EncryptedSecretPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

export function decryptIntegrationSecret(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Partial<EncryptedSecretPayload>;
  if (data.alg !== "aes-256-gcm" || typeof data.iv !== "string" || typeof data.tag !== "string" || typeof data.data !== "string") {
    return null;
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(data.iv, "base64"));
    decipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function encryptedIntegrationSecretJson(value: string) {
  return JSON.stringify(encryptIntegrationSecret(value));
}

export function redactKnownSecrets(value: string) {
  return value
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/\b[0-9a-f]{32}\b/gi, "[redacted-hash]")
    .replace(/(session|api_hash|token|password|secret)(["'\s:=]+)[^"',\s]+/gi, "$1$2[redacted]");
}
