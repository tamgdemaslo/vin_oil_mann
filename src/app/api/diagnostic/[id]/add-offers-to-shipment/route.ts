import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";

type VariantJson = {
  label: string;
  priceRub: number;
  moySkladProductId?: string;
};

function lineTotalCents(position: { quantity: Prisma.Decimal | number; priceCentsPerUnit: number; discount: Prisma.Decimal | number }) {
  const quantity = typeof position.quantity === "number" ? position.quantity : position.quantity.toNumber();
  const discount = typeof position.discount === "number" ? position.discount : position.discount.toNumber();
  return Math.round(quantity * position.priceCentsPerUnit * (1 - discount / 100));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id: diagnosticId } = await params;
  if (!diagnosticId) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: {
    selections: { offerId: string; variantIndex: number }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const diagnostic = await prisma.diagnostic.findUnique({ where: { id: diagnosticId } });
  if (!diagnostic?.shipmentMoySkladId) {
    return NextResponse.json({ error: "У диагностики не привязана локальная отгрузка" }, { status: 400 });
  }
  const shipmentId = diagnostic.shipmentMoySkladId;

  const selections = Array.isArray(body.selections) ? body.selections : [];
  if (selections.length === 0) return NextResponse.json({ ok: true });

  try {
    await prisma.$transaction(async (tx) => {
      const demand = await tx.localDemand.findFirst({
        where: { OR: [{ id: shipmentId }, { moyskladId: shipmentId }] },
      });
      if (!demand) throw new Error("Локальная отгрузка для диагностики не найдена");
      const existingPositions = await tx.localDemandPosition.findMany({ where: { demandId: demand.id } });

      const createdPositions: {
        productId: string;
        name: string;
        priceCentsPerUnit: number;
        buyPriceCentsPerUnit: number | null;
        slotName: string | null;
      }[] = [];

      for (const sel of selections) {
        const offer = await tx.diagnosticOffer.findFirst({ where: { id: sel.offerId, diagnosticId } });
        if (!offer || offer.nextVisitOnly) continue;

        const variants = offer.variants as unknown as VariantJson[];
        const idx = typeof sel.variantIndex === "number" ? sel.variantIndex : 0;
        const v = variants[idx];
        if (!v?.moySkladProductId) continue;

        const product = await tx.localProduct.findFirst({
          where: { OR: [{ id: v.moySkladProductId }, { moyskladId: v.moySkladProductId }] },
        });
        if (!product) continue;

        const stock = demand.storeId
          ? await tx.localStockBalance.findUnique({
              where: { productId_storeId: { productId: product.id, storeId: demand.storeId } },
            })
          : null;

        if (demand.applicable && demand.storeId) {
          const available = stock ? stock.quantity.toNumber() - stock.reserve.toNumber() : 0;
          if (available < 1) throw new Error(`Недостаточно остатков для ${product.name}`);
          await tx.localStockBalance.update({
            where: { id: stock!.id },
            data: {
              quantity: new Prisma.Decimal(stock!.quantity.toNumber() - 1),
              available: new Prisma.Decimal(available - 1),
              syncedAt: new Date(),
            },
          });
        }

        createdPositions.push({
          productId: product.id,
          name: product.name,
          priceCentsPerUnit: Math.round((Number(v.priceRub) || product.salePriceCents / 100) * 100),
          buyPriceCentsPerUnit: stock?.buyPriceCents ?? product.buyPriceCents ?? null,
          slotName: stock?.slotName ?? product.cell ?? null,
        });

        await tx.diagnosticOffer.update({
          where: { id: offer.id },
          data: { addedToShipment: true, selectedVariantIndex: idx },
        });
      }

      if (createdPositions.length === 0) return;

      await tx.localDemandPosition.createMany({
        data: createdPositions.map((position) => ({
          demandId: demand.id,
          productId: position.productId,
          assortmentMoyskladId: position.productId,
          assortmentType: "product",
          name: position.name,
          quantity: new Prisma.Decimal(1),
          priceCentsPerUnit: position.priceCentsPerUnit,
          discount: new Prisma.Decimal(0),
          vat: 0,
          vatEnabled: false,
          buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
          slotName: position.slotName,
          raw: { source: "diagnostic-offer" },
        })),
      });

      const sumCents =
        existingPositions.reduce((sum, position) => sum + lineTotalCents(position), 0) +
        createdPositions.reduce((sum, position) => sum + position.priceCentsPerUnit, 0);
      await tx.localDemand.update({ where: { id: demand.id }, data: { sumCents, syncedAt: new Date() } });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось добавить предложения в отгрузку" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
