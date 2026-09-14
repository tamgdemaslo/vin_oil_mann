export function isValidBookingCustomerName(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().normalize("NFC");
  return normalized.length > 0 && /\p{L}/u.test(normalized);
}
