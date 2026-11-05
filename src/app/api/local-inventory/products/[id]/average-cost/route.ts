import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { lockInventoryCostKeys } from "@/lib/inventory-costing-db";
import { invalidateWarehouseReadCaches } from "@/lib/local-inventory-admin";

const validCost = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return error("Необходима авторизация", 401);
  if (session.user.role !== "owner") return error("Изменять среднюю себестоимость может только владелец", 403);

  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  const branchId = access.context.branchId;
  if (!branchId) return error("Выберите филиал", 400);

  const { id: productId } = await params;
  const body = await request.json().catch(() => null);
  const storeId = typeof body?.storeId === "string" ? body.storeId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const averageCostCents = body?.averageCostCents;
  const expectedCostCents = body?.expectedCostCents;
  if (!storeId || !validCost(averageCostCents) || !reason || reason.length > 500 ||
      (expectedCostCents !== null && !validCost(expectedCostCents))) {
    return error("Укажите склад, положительную себестоимость и основание до 500 символов", 400);
  }

  try {
    const result = await runWithBranchApiContext(access.context, () => prisma.$transaction(async (tx) => {
      await lockInventoryCostKeys(tx, { branchId, storeId, productIds: [productId] });
      const [product, store, balance] = await Promise.all([
        tx.localProduct.findFirst({ where: { id: productId, branchId, archived: false }, select: { entityType: true } }),
        tx.localStore.findFirst({ where: { id: storeId, branchId, archived: false }, select: { id: true } }),
        tx.localStockBalance.findFirst({ where: { branchId, productId, storeId } }),
      ]);
      if (!product || !store) return error("Активный товар или склад не найден в выбранном филиале", 404);
      if (!["product", "variant", "bundle"].includes(product.entityType)) return error("Себестоимость задаётся для складских товаров", 400);

      const previousCost = balance?.buyPriceCents ?? null;
      if (previousCost === averageCostCents) return NextResponse.json({ averageCostCents });
      if ((validCost(previousCost) ? previousCost : null) !== expectedCostCents) {
        return error("Себестоимость уже изменилась. Обновите карточку перед повторным вводом", 409);
      }

      const updated = balance
        ? await tx.localStockBalance.update({
          where: { id: balance.id, branchId },
          data: { buyPriceCents: averageCostCents, syncedAt: new Date() },
        })
        : await tx.localStockBalance.create({
          data: { branchId, productId, storeId, buyPriceCents: averageCostCents },
        });

      await tx.inventoryLedgerEntry.create({
        data: {
          branchId,
          productId,
          storeId,
          sourceType: "MANUAL_AVERAGE_COST",
          sourceId: updated.id,
          movementType: previousCost != null && previousCost > 0 ? "AVERAGE_COST_CORRECTED" : "OPENING_COST_CONFIRMED",
          quantityDelta: 0,
          unitCostSnapshot: averageCostCents,
          totalCostSnapshot: 0,
          analyticsImpact: false,
          createdById: session.user.login,
          createdByName: session.user.name,
          raw: { reason, previousCostCents: previousCost, quantity: updated.quantity.toString() },
        },
      });
      return NextResponse.json({ averageCostCents });
    }));
    if (result.ok) invalidateWarehouseReadCaches();
    return result;
  } catch (cause) {
    console.error("Failed to save manual average inventory cost", cause);
    return error("Не удалось сохранить среднюю себестоимость", 500);
  }
}
