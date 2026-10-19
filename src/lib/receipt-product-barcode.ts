import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { buildCatalogSearchText } from "@/lib/catalog-search";
import { invalidateProductFilterOptions } from "@/lib/local-inventory-admin";
import { lockProductBarcodeBinding, normalizeBindableBarcode, productBarcodePatch, productBarcodeWhere } from "@/lib/product-barcode-binding";

export async function bindReceiptProductBarcode(context: BranchContext, body: { productId?: unknown; barcode?: unknown }) {
  const branchId = context.branchId;
  if (!branchId) return { ok: false as const, status: 409, error: "Выберите активный филиал" };
  let barcode: string;
  try { barcode = normalizeBindableBarcode(body.barcode); }
  catch (error) { return { ok: false as const, status: 400, error: (error as Error).message }; }
  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  if (!productId) return { ok: false as const, status: 400, error: "Выберите товар для привязки штрихкода" };

  const result = await prisma.$transaction(async (tx) => {
    await lockProductBarcodeBinding(tx, branchId, productId, barcode);
    const product = await tx.localProduct.findFirst({ where: { id: productId, branchId, archived: false, entityType: { not: "service" } } });
    if (!product) return { ok: false as const, status: 404, error: "Товар не найден в текущем филиале" };
    const conflict = await tx.localProduct.findFirst({
      where: { branchId, id: { not: productId }, ...productBarcodeWhere(barcode) }, select: { name: true },
    });
    if (conflict) return { ok: false as const, status: 409, error: `Этот штрихкод уже привязан к товару «${conflict.name}»` };
    let patch: ReturnType<typeof productBarcodePatch>;
    try { patch = productBarcodePatch(product, barcode); }
    catch (error) { return { ok: false as const, status: 409, error: (error as Error).message }; }
    const alreadyLinked = Object.keys(patch).length === 0;
    if (!alreadyLinked) {
      // Keep supplier and legacy search terms alongside the newly indexed barcode.
      const searchText = [product.searchText, buildCatalogSearchText({ ...product, ...patch })].filter(Boolean).join(" ");
      await tx.localProduct.update({ where: { id: productId, branchId }, data: { ...patch, searchText } });
      await tx.branchAuditLog.create({ data: {
        businessGroupId: context.businessGroupId, branchId, userId: context.userId,
        action: "PRODUCT_BARCODE_LINKED", entityType: "local_product", entityId: productId,
        metadata: { source: "RECEIPT", barcode, fields: Object.keys(patch) },
      } });
    }
    return { ok: true as const, productId, alreadyLinked };
  }, { timeout: 20_000 });
  if (result.ok) invalidateProductFilterOptions();
  return result;
}
