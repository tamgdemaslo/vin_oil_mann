import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AIAssistantAccess } from "./access";
import { prisma } from "@/lib/db";
import type { CreateDemandBody } from "@/lib/demand-create-payload";
import type { QuickAnswer, QuickShipmentPreview } from "@/lib/quick-assistant";

const MAX_POSITIONS = 80;

export class QuickShipmentError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

export async function findQuickShipmentOrder(branchId: string, reference: string, customer: string, phone: string | null, latest: boolean) {
  const selector: Prisma.LocalDemandWhereInput | null = reference
    ? { OR: [{ id: reference }, { name: reference }] }
    : phone ? { counterparty: { normalizedPhone: phone } }
    : customer ? { OR: [
      { agentNameSnapshot: { contains: customer, mode: "insensitive" } },
      { counterparty: { name: { contains: customer, mode: "insensitive" } } },
    ] } : null;
  if (!selector) return { answer: { text: "Укажите номер заказ-наряда или клиента.", sources: [] } satisfies QuickAnswer };

  const orders = await prisma.localDemand.findMany({
    where: { branchId, ...selector, ...(!reference && latest ? { NOT: { id: { startsWith: "quick-" } } } : {}) },
    select: { id: true, name: true, agentNameSnapshot: true, counterpartyId: true, documentDate: true },
    orderBy: [{ momentAt: "desc" }, { id: "desc" }],
    take: 6,
  });
  if (orders.length === 1 || (orders.length > 1 && !reference && latest &&
    orders[0].counterpartyId && orders.length < 6 && orders.every(order => order.counterpartyId === orders[0].counterpartyId))) {
    return { sourceId: orders[0].id };
  }
  return { answer: {
    text: orders.length ? "Нашёл несколько заказ-нарядов. Уточните номер исходного заказа." : "В выбранном филиале заказ-наряд по этим данным не найден.",
    sources: orders.slice(0, 5).map(order => ({
      label: [`№ ${order.name}`, order.agentNameSnapshot, order.documentDate].filter(Boolean).join(" · "),
      href: `/shipment/${encodeURIComponent(order.id)}/edit`,
    })),
  } satisfies QuickAnswer };
}

export async function prepareQuickShipment(access: AIAssistantAccess, sourceId: string, nonce: string = randomUUID()) {
  const branchId = access.branchId;
  const order = await prisma.localDemand.findFirst({
    where: { id: sourceId, branchId },
    select: {
      id: true, name: true, updatedAt: true,
      counterparty: { select: { id: true, name: true, archived: true } },
      store: { select: { id: true, name: true, archived: true, organizationId: true } },
      organization: { select: { id: true, name: true, isActive: true } },
      positions: {
        orderBy: { id: "asc" },
        take: MAX_POSITIONS + 1,
        select: {
          id: true, name: true, assortmentType: true, quantity: true, priceCentsPerUnit: true,
          discount: true, vat: true, vatEnabled: true, raw: true,
          product: { select: { id: true, name: true, entityType: true, archived: true } },
        },
      },
    },
  });
  if (!order) throw new QuickShipmentError("Заказ-наряд не найден в выбранном филиале.", 404);
  const { counterparty, store, organization } = order;
  if (!counterparty || counterparty.archived || !store || store.archived ||
      !organization?.isActive || organization.id !== access.organizationId ||
      (store.organizationId && store.organizationId !== organization.id)) {
    throw new QuickShipmentError("Проверьте контрагента, склад и организацию в исходном заказ-наряде.");
  }
  if (!order.positions.length || order.positions.length > MAX_POSITIONS) {
    throw new QuickShipmentError(`Для переноса в заказ-наряде должно быть от 1 до ${MAX_POSITIONS} позиций.`);
  }

  const meta = (type: string, id: string) => ({ meta: { href: `local://${type}/${id}`, type, mediaType: "application/json" } });
  const quantities = new Map<string, number>();
  const lines = order.positions.map(line => {
    const product = line.product;
    const raw = line.raw as { comment?: unknown; lineKind?: unknown } | null;
    if (!product || product.archived || line.assortmentType === "nonstock_product" ||
        raw?.lineKind === "one_off_service" || raw?.lineKind === "nonstock_product") {
      throw new QuickShipmentError(`Позицию «${line.name}» нужно перенести вручную. Для автоматического переноса нужна активная позиция каталога.`);
    }
    const quantity = Number(line.quantity);
    const discount = Number(line.discount);
    if (!Number.isFinite(quantity) || !Number.isFinite(discount) || quantity <= 0 || discount < 0 || discount > 100 || line.priceCentsPerUnit < 0) {
      throw new QuickShipmentError(`Проверьте количество, цену и скидку позиции «${line.name}» в заказе.`);
    }
    if (product.entityType !== "service") {
      quantities.set(product.id, (quantities.get(product.id) ?? 0) + Math.round(quantity * 1000));
    }
    return {
      product, quantity, discount, priceCents: line.priceCentsPerUnit,
      vat: line.vat, vatEnabled: line.vatEnabled,
      comment: typeof raw?.comment === "string" ? raw.comment : undefined,
    };
  });

  const stock = quantities.size ? await prisma.localStockBalance.findMany({
    where: { branchId, storeId: store.id, productId: { in: [...quantities.keys()] } },
    select: { productId: true, available: true },
  }) : [];
  const balances = new Map(stock.map(balance => [balance.productId, Number(balance.available)]));
  const positions = lines.map(line => {
    const required = quantities.get(line.product.id);
    const available = required === undefined ? null : balances.get(line.product.id) ?? 0;
    return {
      name: line.product.name, quantity: line.quantity, priceCents: line.priceCents, discount: line.discount,
      vat: line.vatEnabled ? line.vat : null, comment: line.comment,
      available, shortage: required !== undefined && available !== null && Math.round(available * 1000) < required,
    };
  });
  const description = `Из заказ-наряда № ${order.name}`;
  const body: CreateDemandBody = {
    organization: meta("organization", organization.id),
    agent: meta("counterparty", counterparty.id),
    store: meta("store", store.id),
    applicable: false,
    description,
    positions: lines.map(line => ({
      assortment: meta(line.product.entityType, line.product.id),
      name: line.product.name,
      quantity: line.quantity,
      price: line.priceCents / 100,
      discount: line.discount,
      vat: line.vat,
      vatEnabled: line.vatEnabled,
      comment: line.comment,
    })),
  };
  const snapshot = {
    sourceId: order.id, sourceName: order.name, customer: counterparty.name,
    warehouse: store.name, organization: organization.name, description, positions,
    totalCents: lines.reduce((sum, line) => sum + Math.round(line.quantity * line.priceCents * (1 - line.discount / 100)), 0),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({
    branchId, actor: access.actorId, updatedAt: order.updatedAt, body, snapshot, nonce,
  })).digest("hex");
  const preview: QuickShipmentPreview = { ...snapshot, fingerprint, nonce };
  return { preview, body };
}
