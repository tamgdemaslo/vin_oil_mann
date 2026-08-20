import { Prisma } from "@prisma/client";

/**
 * Produces a plain JSON-compatible value without relying on Prisma model
 * instances. Tool audit data often contains Decimal stock balances.
 */
export function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "function" || typeof item === "symbol" || typeof item === "undefined") continue;
      output[key] = jsonSafe(item, seen);
    }
    seen.delete(value);
    return output;
  }
  return String(value);
}

export function jsonSafeRecord(value: unknown): Record<string, unknown> {
  const normalized = jsonSafe(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized as Record<string, unknown> : {};
}
