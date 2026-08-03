import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { toServiceDateInput } from "@/lib/date-time";
import { createLocalStockDocument, listLocalStockDocuments } from "@/lib/local-inventory-admin";
import { type CreateSupplyBody } from "@/lib/supply-create-payload";
import { extractMoyskladEntityId } from "@/lib/piecework-rules";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  const local = await listLocalStockDocuments({ type: "receipt", search, limit, offset });
  return NextResponse.json({
    meta: { size: local.meta.total, limit, offset, source: "local" },
    rows: local.documents.map((document) => ({
      id: document.id,
      name: document.name,
      moment: document.moment,
      applicable: document.applicable,
      sum: Math.round(document.sum * 100),
      payedSum: document.invoice?.status === "paid" ? Math.round(document.sum * 100) : 0,
      incomingNumber: document.invoice?.number ?? "",
      incomingDate: document.invoice?.invoiceDate ?? document.documentDate,
      description: document.description,
      href: `local://receipt/${document.id}`,
      agentName: document.counterpartyName,
      organizationName: "",
      storeName: document.storeName,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: CreateSupplyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if (!body.organization?.meta?.href || !body.agent?.meta?.href || !body.store?.meta?.href) {
    return NextResponse.json({ error: "Укажите организацию, поставщика и склад (meta.href)" }, { status: 400 });
  }
  const organizationId = extractMoyskladEntityId(body.organization.meta.href) ?? body.organization.meta.href;
  const storeId = extractMoyskladEntityId(body.store.meta.href) ?? body.store.meta.href;
  const [organization, store] = await Promise.all([
    prisma.localOrganization.findFirst({ where: { isActive: true, OR: [{ id: organizationId }, { moyskladId: organizationId }] } }),
    prisma.localStore.findFirst({ where: { OR: [{ id: storeId }, { moyskladId: storeId }] } }),
  ]);
  if (!organization) return NextResponse.json({ error: "Организация не найдена в локальной БД" }, { status: 400 });
  if (!store) return NextResponse.json({ error: "Склад не найден в локальной БД" }, { status: 400 });
  if (store.organizationId && store.organizationId !== organization.id) {
    return NextResponse.json({ error: "Выбранный склад не относится к выбранной организации" }, { status: 400 });
  }

  const validPositions = (body.positions ?? []).filter(
    (p) => p.assortment?.meta?.href && Number(p.quantity) > 0
  );
  if (validPositions.length === 0) {
    return NextResponse.json({ error: "Добавьте хотя бы одну позицию приёмки" }, { status: 400 });
  }

  const result = await createLocalStockDocument(
    {
      type: "receipt",
      storeId,
      counterpartyId: extractMoyskladEntityId(body.agent.meta.href) ?? body.agent.meta.href,
      documentDate: (body.incomingDate || body.moment || toServiceDateInput(new Date())).slice(0, 10),
      moment: body.moment,
      description: body.description,
      applicable: body.applicable !== false,
      positions: validPositions.map((position) => ({
        productId: extractMoyskladEntityId(position.assortment.meta.href) ?? position.assortment.meta.href,
        quantity: Number(position.quantity) || 1,
        price: Number(position.price) || 0,
      })),
    },
    session.user
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({
    id: result.document.id,
    name: result.document.name,
    moment: body.moment,
    applicable: body.applicable !== false,
    sum: Math.round(validPositions.reduce((sum, position) => {
      const quantity = Number(position.quantity) || 1;
      const price = Number(position.price) || 0;
      const discount = Number(position.discount) || 0;
      return sum + quantity * price * (1 - Math.min(100, Math.max(0, discount)) / 100);
    }, 0) * 100),
    href: `local://receipt/${result.document.id}`,
  });
}
