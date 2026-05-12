import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { moyskladFetch } from "@/lib/moysklad";
import { productMetaFromId } from "@/lib/diagnostic-moysklad-resolve";

type VariantJson = {
  label: string;
  priceRub: number;
  moySkladProductId?: string;
};

type DemandPositionRow = {
  id: string;
  quantity: number;
  price: number;
  assortment?: { meta?: { href: string; type?: string; mediaType?: string }; name?: string };
  discount?: number;
};

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

  const diagnostic = await prisma.diagnostic.findUnique({
    where: { id: diagnosticId },
  });
  if (!diagnostic?.shipmentMoySkladId) {
    return NextResponse.json(
      { error: "У диагностики не привязана отгрузка МойСклад" },
      { status: 400 }
    );
  }

  const demandId = diagnostic.shipmentMoySkladId;

  const current = await moyskladFetch<{ rows: DemandPositionRow[] }>(
    `/entity/demand/${demandId}/positions`,
    { cache: "no-store" }
  );
  if (!current.ok) {
    return NextResponse.json({ error: current.error }, { status: 502 });
  }

  const nextPositions: DemandPositionRow[] = [];
  for (const row of current.data.rows ?? []) {
    nextPositions.push({
      id: row.id,
      quantity: row.quantity,
      price: row.price,
      assortment: row.assortment,
      discount: typeof row.discount === "number" ? row.discount : 0,
    });
  }

  const selections = Array.isArray(body.selections) ? body.selections : [];

  for (const sel of selections) {
    const offer = await prisma.diagnosticOffer.findFirst({
      where: { id: sel.offerId, diagnosticId },
    });
    if (!offer || offer.nextVisitOnly) continue;

    const variants = offer.variants as unknown as VariantJson[];
    const idx = typeof sel.variantIndex === "number" ? sel.variantIndex : 0;
    const v = variants[idx];
    if (!v?.moySkladProductId) continue;

    nextPositions.push({
      id: "",
      quantity: 1,
      price: Math.round(v.priceRub * 100),
      assortment: {
        meta: productMetaFromId(v.moySkladProductId),
      },
      discount: 0,
    });

    await prisma.diagnosticOffer.update({
      where: { id: offer.id },
      data: { addedToShipment: true, selectedVariantIndex: idx },
    });
  }

  const put = await moyskladFetch(`/entity/demand/${demandId}`, {
    method: "PUT",
    body: JSON.stringify({ positions: nextPositions }),
    cache: "no-store",
  });

  if (!put.ok) {
    return NextResponse.json({ error: put.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
