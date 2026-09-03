import { Prisma } from "@prisma/client";

/**
 * Serializes cost/quantity changes even when the balance row does not exist yet.
 * Keys are sorted to keep multi-product documents free from lock-order deadlocks.
 */
export async function lockInventoryCostKeys(
  tx: Prisma.TransactionClient,
  input: { branchId: string; storeId: string; productIds: string[] }
) {
  const keys = [...new Set(input.productIds)]
    .filter(Boolean)
    .map((productId) => `${input.branchId}:${input.storeId}:${productId}`)
    .sort();
  for (const key of keys) {
    await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked
    `);
  }
}
