type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function nestedValue(source: JsonRecord, keys: string[]): unknown {
  let cursor: unknown = source;
  for (const key of keys) cursor = asRecord(cursor)[key];
  return cursor;
}

function text(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function truthyPaymentValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return ["true", "yes", "paid", "оплачено", "оплачен", "оплачена", "проведена"].includes(text(value));
}

export type DemandPaymentStatus = "paid" | "unpaid" | "unknown";

/**
 * Reads the payment state recorded by the source system. Document total is not
 * used as a proxy: a non-zero shipment can still be unpaid.
 */
export function demandPaymentStatusFromRaw(raw: unknown, applicable: boolean): DemandPaymentStatus {
  const record = asRecord(raw);
  const stateName = text(nestedValue(record, ["state", "name"]));
  const paymentStatus = text(record.paymentStatus ?? record.payment_status ?? record.paidStatus);
  const paidFlag = truthyPaymentValue(record.paid ?? record.isPaid ?? record.payed ?? record.paymentCompleted);
  if (paidFlag || stateName.includes("оплачен") || paymentStatus.includes("paid") || paymentStatus.includes("оплачен")) {
    return "paid";
  }
  return applicable ? "unknown" : "unpaid";
}
