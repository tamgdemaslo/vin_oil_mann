import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { enableWarehouseBarrelTrackingTx, attachExistingBarrelTx, listProductBarrels, lockBarrelProducts, switchBarrelTx } from "@/lib/bulk-oil-barrels";
import { canManageWarehouseMarking, createLocalStockDocument, invalidateWarehouseReadCaches } from "@/lib/local-inventory-admin";
import { lockInventoryCostKeys } from "@/lib/inventory-costing-db";

type Params = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Params) {
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;
  const { id } = await params;
  return runWithBranchApiContext(access.context, async () => {
    try { return NextResponse.json(await listProductBarrels(access.context.branchId!, id)); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить бочки." }, { status: 400 }); }
  });
}
export async function POST(request: NextRequest, { params }: Params) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (!canManageWarehouseMarking(access.context.user)) return NextResponse.json({ error: "Недостаточно прав для смены бочки." }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return NextResponse.json({ error: "Неверное тело запроса." }, { status: 400 }); }
  const branchId = access.context.branchId!;
  return runWithBranchApiContext(access.context, async () => {
    try {
      await prisma.$transaction(async (tx) => {
        if (body.action === "enable") {
          await lockInventoryCostKeys(tx, { branchId, storeId: String(body.storeId ?? ""), productIds: [id] });
          await lockBarrelProducts(tx, branchId, [id]);
          const product = await tx.localProduct.findFirst({ where: { branchId, id } });
          if (!product) throw new Error("Товар не найден.");
          await enableWarehouseBarrelTrackingTx(tx, branchId, product, String(body.storeId ?? ""), access.context.user);
        } else if (body.action === "attach-existing") {
          await lockInventoryCostKeys(tx, { branchId, storeId: String(body.storeId ?? ""), productIds: [id] });
          await attachExistingBarrelTx(tx, { branchId, productId: id, storeId: String(body.storeId ?? ""),
            markingCode: String(body.markingCode ?? ""), volumeLiters: Number(String(body.volumeLiters ?? "").replace(",", ".")), actor: access.context.user });
        } else if (body.action === "switch") {
          // Inventory cost locks precede product locks, just as in receipt posting.
          const open = await tx.localBulkOilBarrel.findFirst({ where: { branchId, productId: id, status: "OPEN" } });
          if (open) await lockInventoryCostKeys(tx, { branchId, storeId: open.storeId, productIds: [id] });
          await switchBarrelTx(tx, { branchId, productId: id, barrelId: typeof body.barrelId === "string" ? body.barrelId : undefined,
            scannedCode: typeof body.scannedCode === "string" ? body.scannedCode : undefined,
            expectedActiveId: String(body.expectedActiveId ?? ""),
            expectedRemainingLiters: body.expectedRemainingLiters == null ? null : Number(body.expectedRemainingLiters),
            confirmEmpty: body.confirmEmpty === true, reason: String(body.reason ?? ""),
            alreadyAdjustedDocumentId: typeof body.alreadyAdjustedDocumentId === "string" ? body.alreadyAdjustedDocumentId : undefined,
            actor: access.context.user,
          }, async (barrel) => {
            const result = await createLocalStockDocument({ type: "writeoff", storeId: barrel.storeId, applicable: true,
              adjustmentType: "expense", adjustmentMethod: "WRITE_OFF_QUANTITY", adjustmentReason: "Другое фактическое списание",
              description: `Закрытие бочки ${barrel.number}: ${String(body.reason ?? "").trim()}`,
              positions: [{ productId: id, quantity: barrel.remainingLiters }],
            }, access.context.user, { transaction: tx });
            if (!result.ok) throw new Error(result.error);
            return result.document.id;
          });
        } else throw new Error("Неизвестное действие с бочкой.");
      });
      invalidateWarehouseReadCaches();
      return NextResponse.json(await listProductBarrels(branchId, id));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сменить бочку." }, { status: 409 });
    }
  });
}
