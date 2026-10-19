import { Prisma } from "@prisma/client";
export { normalizeBindableBarcode, isProductBarcodeSearch, productBarcodeWhere, productBarcodePatch } from "@/lib/product-barcode-input";

/** Serialize both competing owners and competing codes for the same product. */
export async function lockProductBarcodeBinding(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">, branchId: string, productId: string, barcode: string,
) {
  for (const key of [`barcode:${branchId}:${barcode}`, `product-barcode:${branchId}:${productId}`].sort()) {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`);
  }
}
