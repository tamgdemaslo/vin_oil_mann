import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export function requestDigest(value: unknown) {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, stable(val)]));
    }
    return item;
  };
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export async function loyaltyLock(tx: Prisma.TransactionClient, key: string) {
  // The SELECT returns a serializable type for Prisma instead of PostgreSQL void.
  await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS lock`;
}

export function postingRequestKey(value: unknown) {
  if (value == null) return undefined;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Неверный ключ проведения отгрузки");
  return value;
}
