import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const document = await prisma.localInventoryDocument.findFirst({
    where: { id, type: "receipt" },
    include: {
      counterparty: true,
      store: true,
      positions: { include: { product: true }, orderBy: { id: "asc" } },
      supplierInvoice: true,
    },
  });
  if (!document) return NextResponse.json({ error: "Локальная приёмка не найдена" }, { status: 404 });

  return NextResponse.json({
    header: {
      id: document.id,
      name: document.name,
      moment: document.momentAt.toISOString(),
      applicable: document.applicable,
      description: document.description ?? "",
      sum: document.sumCents,
      payedSum: document.supplierInvoice?.paidAmountCents ?? 0,
      incomingNumber: document.supplierInvoice?.number ?? "",
      incomingDate: document.supplierInvoice?.invoiceDate ?? document.documentDate,
      href: `local://receipt/${document.id}`,
      agentName: document.counterparty?.name ?? document.counterpartyNameSnapshot ?? "",
      organizationName: "",
      storeName: document.store?.name ?? document.storeNameSnapshot ?? "",
    },
    positions: document.positions.map((position) => ({
      id: position.id,
      name: position.productName,
      code: position.product?.article ?? position.product?.code ?? "",
      quantity: position.quantity.toNumber(),
      price: position.priceCentsPerUnit / 100,
      discount: 0,
      vat: 0,
      vatEnabled: false,
      assortmentMeta: position.product
        ? {
            href: position.product.moyskladHref ?? `local://${position.product.entityType}/${position.product.id}`,
            type: position.product.entityType,
            mediaType: "application/json",
          }
        : undefined,
    })),
  });
}
