import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { resolveCatalogProductSelection } from "@/lib/catalog-search";
import { executeProductCopy, ProductCopyError } from "@/lib/product-copy-between-branches";

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const body = await request.json();
    let productIds = Array.isArray(body?.productIds) && body.productIds.length ? body.productIds : [];
    if (!productIds.length && body?.selection) {
      try {
        productIds = (await runWithBranchApiContext(branch.context, () => resolveCatalogProductSelection(body.selection, 500))).productIds;
      } catch (selectionError) {
        throw new ProductCopyError(selectionError instanceof Error ? selectionError.message : "Не удалось прочитать выбор товаров", 400, "selection_invalid");
      }
    }
    const result = await executeProductCopy(branch.context, {
      targetBranchId: body?.targetBranchId,
      productIds,
      options: body?.options,
      idempotencyKey: body?.idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductCopyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("product copy execute failed", error);
    return NextResponse.json({ error: "Не удалось скопировать карточки товаров" }, { status: 500 });
  }
}
