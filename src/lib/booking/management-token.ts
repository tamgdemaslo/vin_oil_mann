import crypto from "node:crypto";
import { BookingError } from "./errors";

function tokenSecret() {
  const directSecret = process.env.BOOKING_MANAGEMENT_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (directSecret) return directSecret;
  const integrationSecret = process.env.MESSENGER_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (integrationSecret) {
    return crypto
      .createHmac("sha256", integrationSecret)
      .update("eco-booking-management-token-v1", "utf8")
      .digest("base64url");
  }
  if (process.env.NODE_ENV === "production") {
    throw new BookingError("Секрет управления записью не настроен", "booking_token_secret_missing", 500);
  }
  return "eco-booking-development-only";
}

function signature(payload: string) {
  return crypto.createHmac("sha256", tokenSecret()).update(payload, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createManagementHandle() {
  return crypto.randomBytes(24).toString("base64url");
}

export function createManagementToken(handle: string, version: number) {
  const payload = `${handle}.${version}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyManagementToken(token: string) {
  const [handle, versionRaw, supplied, extra] = token.split(".");
  const version = Number.parseInt(versionRaw ?? "", 10);
  if (!handle || !supplied || extra || !Number.isSafeInteger(version) || version < 1) {
    throw new BookingError("Ссылка управления записью недействительна", "booking_manage_token_invalid", 404);
  }
  const payload = `${handle}.${version}`;
  if (!safeEqual(signature(payload), supplied)) {
    throw new BookingError("Ссылка управления записью недействительна", "booking_manage_token_invalid", 404);
  }
  return { handle, version };
}
