import { createHash } from "node:crypto";
import { BookingError } from "./errors";

export function publicBookingIdempotencyAuditId(branchId: string, value: string | null | undefined) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || !/^[A-Za-z0-9._~-]{16,128}$/u.test(key)) {
    throw new BookingError("Некорректный ключ операции", "booking_idempotency_key_invalid");
  }
  return `booking_public_idem_${createHash("sha256").update(`${branchId}:${key}`).digest("hex")}`;
}
