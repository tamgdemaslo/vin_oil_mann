import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { inventoryPreviewScope } from "@/lib/inventory-catalog-preview";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const { branchId } = access.context;
  const params = request.nextUrl.searchParams;
  const storeId = params.get("storeId")?.trim();
  const productIds = [...new Set(params.getAll("id").filter((id) => id && id.length <= 128))];
  if (!branchId || !storeId || storeId.length > 128 || !productIds.length || productIds.length > 50) {
    return NextResponse.json({ error: "Укажите склад и товары для загрузки остатков" }, { status: 400 });
  }

  return runWithBranchApiContext(access.context, async () => {
    const store = await prisma.localStore.findFirst({
      where: { branchId, id: storeId },
      select: { stockBalances: {
        where: { branchId, productId: { in: productIds } },
        select: { productId: true, quantity: true, available: true },
      } },
    });
    if (!store) return NextResponse.json({ error: "Склад не найден" }, { status: 404 });
    return NextResponse.json({
      scope: inventoryPreviewScope(access.context),
      balances: Object.fromEntries(store.stockBalances.map(({ productId, quantity, available }) => [
        productId,
        { quantity: Number(quantity), available: Number(available) },
      ])),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
