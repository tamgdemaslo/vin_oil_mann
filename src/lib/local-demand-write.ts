import { Prisma } from "@prisma/client";
import { type CreateDemandBody } from "@/lib/demand-create-payload";
import { ensureDemandAttributeMetadata } from "@/lib/demand-attributes";
import { invalidateDemandListCache } from "@/lib/demand-list-cache";
import { prisma } from "@/lib/db";
import { invalidateWarehouseReadCaches } from "@/lib/local-inventory-admin";
import { extractMoyskladEntityId } from "@/lib/piecework-rules";
import type {
  DemandDetailAttribute,
  DemandDetailPayload,
  DemandDetailPosition,
} from "@/lib/demand-detail-load";

type MoySkladMeta = {
  href: string;
  type: string;
  mediaType: string;
};

type UpdateDemandBody = {
  organization?: { meta: MoySkladMeta };
  agent?: { meta: MoySkladMeta };
  store?: { meta: MoySkladMeta };
  name?: string;
  description?: string;
  moment?: string;
  applicable?: boolean;
  attributes?: unknown[];
  positions?: {
    id?: string;
    quantity: number;
    price: number;
    discount?: number;
    assortment?: { meta: MoySkladMeta };
  }[];
};

type ResolvedPosition = {
  id?: string;
  moyskladPositionId?: string | null;
  productId: string | null;
  assortmentMoyskladId: string | null;
  assortmentType: string;
  name: string;
  quantity: Prisma.Decimal;
  priceCentsPerUnit: number;
  discount: Prisma.Decimal;
  vat: number;
  vatEnabled: boolean;
  buyPriceCentsPerUnit: number | null;
  slotName: string | null;
  raw: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

type StockMovementPosition = {
  productId: string | null;
  assortmentType: string;
  quantity: Prisma.Decimal | number;
};

export function isLocalInventoryWritesEnabled(): boolean {
  return true;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function entityIdFromMeta(meta?: { href?: string } | null): string | null {
  return extractMoyskladEntityId(meta?.href);
}

function localMeta(type: string, id: string, href?: string | null): MoySkladMeta {
  return {
    href: href || `local://${type}/${id}`,
    type,
    mediaType: "application/json",
  };
}

function moyskladMeta(type: string, id: string | null | undefined, href?: string | null): MoySkladMeta {
  return {
    href: href || (id ? `local://${type}/${id}` : `local://${type}`),
    type,
    mediaType: "application/json",
  };
}

function entityMeta(type: string, moyskladId: string | null | undefined, href: string | null | undefined, localId: string): MoySkladMeta {
  return {
    href: href || `local://${type}/${localId || moyskladId || ""}`,
    type,
    mediaType: "application/json",
  };
}

function parseMoment(value?: string): { documentDate: string; momentAt: Date } {
  const raw = value?.trim() || new Date().toISOString();
  const documentDate = raw.slice(0, 10);
  const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  const parsed = new Date(normalized);
  return {
    documentDate,
    momentAt: Number.isFinite(parsed.getTime()) ? parsed : new Date(`${documentDate}T00:00:00`),
  };
}

async function nextLocalDemandName(documentDate: string): Promise<string> {
  const count = await prisma.localDemand.count({ where: { documentDate } });
  return `ЭКО-${documentDate.replaceAll("-", "")}-${String(count + 1).padStart(3, "0")}`;
}

function decimalToNumber(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function lineTotalCents(position: Pick<ResolvedPosition, "quantity" | "priceCentsPerUnit" | "discount">): number {
  const quantity = decimalToNumber(position.quantity);
  const discount = decimalToNumber(position.discount);
  return Math.round(quantity * position.priceCentsPerUnit * (1 - discount / 100));
}

function sumPositionsCents(positions: Pick<ResolvedPosition, "quantity" | "priceCentsPerUnit" | "discount">[]): number {
  return positions.reduce((sum, position) => sum + lineTotalCents(position), 0);
}

function isStockTrackedType(type: string): boolean {
  return type === "product" || type === "variant" || type === "bundle";
}

function normalizeAttributeName(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

async function buildLocalDemandAttributes(
  input: CreateDemandBody["attributes"] | unknown[] | undefined,
  ecoUserName?: string
): Promise<Array<{ definitionId: string; name: string; value: unknown }>> {
  const definitions = await prisma.demandAttributeDefinition.findMany();
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const byName = new Map(definitions.map((definition) => [normalizeAttributeName(definition.name), definition]));
  const out = new Map<string, { definitionId: string; name: string; value: unknown }>();

  for (const attr of Array.isArray(input) ? input : []) {
    if (!attr || typeof attr !== "object") continue;
    const record = attr as { id?: unknown; name?: unknown; value?: unknown };
    const value = record.value;
    if (value == null || value === "") continue;
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name : "";
    const definition = byId.get(id) ?? byName.get(normalizeAttributeName(name));
    if (!definition) continue;
    out.set(definition.id, { definitionId: definition.id, name: definition.name, value });
  }

  const ecoDefinition = byName.get(normalizeAttributeName("Эко пользователь"));
  if (ecoDefinition && ecoUserName?.trim()) {
    out.set(ecoDefinition.id, { definitionId: ecoDefinition.id, name: ecoDefinition.name, value: ecoUserName.trim() });
  }

  return [...out.values()];
}

async function resolveCreatePositions(
  positions: CreateDemandBody["positions"] | undefined,
  storeId?: string | null
): Promise<ResolvedPosition[]> {
  const input = positions ?? [];
  const assortmentIds = input
    .map((position) => entityIdFromMeta(position.assortment?.meta))
    .filter((id): id is string => Boolean(id));
  const products = assortmentIds.length
    ? await prisma.localProduct.findMany({
        where: { OR: [{ id: { in: [...new Set(assortmentIds)] } }, { moyskladId: { in: [...new Set(assortmentIds)] } }] },
      })
    : [];
  const productByExternalId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByExternalId.set(product.id, product);
    if (product.moyskladId) productByExternalId.set(product.moyskladId, product);
  }
  const balances = storeId
    ? await prisma.localStockBalance.findMany({
        where: {
          storeId,
          productId: { in: products.map((product) => product.id) },
        },
      })
    : [];
  const balanceByProductId = new Map(balances.map((balance) => [balance.productId, balance]));

  return input.map((position) => {
    const meta = position.assortment?.meta;
    const assortmentMoyskladId = entityIdFromMeta(meta);
    const product = assortmentMoyskladId ? productByExternalId.get(assortmentMoyskladId) : undefined;
    const balance = product ? balanceByProductId.get(product.id) : undefined;
    const quantity = Number(position.quantity) || 0;
    const priceCents = Math.round((Number(position.price) || 0) * 100);
    const discount = typeof position.discount === "number" ? position.discount : 0;
    return {
      productId: product?.id ?? null,
      assortmentMoyskladId,
      assortmentType: meta?.type ?? product?.entityType ?? "",
      name: product?.name ?? assortmentMoyskladId ?? "Позиция",
      quantity: new Prisma.Decimal(quantity),
      priceCentsPerUnit: priceCents,
      discount: new Prisma.Decimal(discount),
      vat: position.vat ?? 0,
      vatEnabled: position.vatEnabled ?? false,
      buyPriceCentsPerUnit: balance?.buyPriceCents ?? product?.buyPriceCents ?? null,
      slotName: balance?.slotName ?? product?.cell ?? null,
      raw: toJson(position),
    };
  });
}

async function resolveUpdatePositions(
  positions: NonNullable<UpdateDemandBody["positions"]>,
  existingById: Map<string, StockMovementPosition & { name: string; productId: string | null; buyPriceCentsPerUnit: number | null }>
): Promise<ResolvedPosition[]> {
  const assortmentIds = positions
    .map((position) => entityIdFromMeta(position.assortment?.meta))
    .filter((id): id is string => Boolean(id));
  const products = assortmentIds.length
    ? await prisma.localProduct.findMany({
        where: { OR: [{ id: { in: [...new Set(assortmentIds)] } }, { moyskladId: { in: [...new Set(assortmentIds)] } }] },
      })
    : [];
  const productByExternalId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByExternalId.set(product.id, product);
    if (product.moyskladId) productByExternalId.set(product.moyskladId, product);
  }

  return positions.map((position) => {
    const existing = position.id ? existingById.get(position.id) : undefined;
    const meta = position.assortment?.meta;
    const assortmentMoyskladId = entityIdFromMeta(meta);
    const product = assortmentMoyskladId ? productByExternalId.get(assortmentMoyskladId) : undefined;
    const quantity = Number(position.quantity) || 0;
    const priceCents = Math.round(Number(position.price) || 0);
    const discount = typeof position.discount === "number" ? position.discount : 0;
    return {
      id: position.id,
      productId: product?.id ?? existing?.productId ?? null,
      assortmentMoyskladId,
      assortmentType: meta?.type ?? existing?.assortmentType ?? product?.entityType ?? "",
      name: product?.name ?? existing?.name ?? assortmentMoyskladId ?? "Позиция",
      quantity: new Prisma.Decimal(quantity),
      priceCentsPerUnit: priceCents,
      discount: new Prisma.Decimal(discount),
      vat: 0,
      vatEnabled: false,
      buyPriceCentsPerUnit: product?.buyPriceCents ?? existing?.buyPriceCentsPerUnit ?? null,
      slotName: null,
      raw: toJson(position),
    };
  });
}

function appliedQuantityByProduct(positions: StockMovementPosition[], applicable: boolean): Map<string, number> {
  const map = new Map<string, number>();
  if (!applicable) return map;
  for (const position of positions) {
    if (!position.productId || !isStockTrackedType(position.assortmentType)) continue;
    map.set(position.productId, (map.get(position.productId) ?? 0) + decimalToNumber(position.quantity));
  }
  return map;
}

async function applyStockMovements(
  tx: Prisma.TransactionClient,
  storeId: string | null,
  oldPositions: StockMovementPosition[],
  oldApplicable: boolean,
  newPositions: StockMovementPosition[],
  newApplicable: boolean
) {
  if (!storeId) return;
  const oldByProduct = appliedQuantityByProduct(oldPositions, oldApplicable);
  const newByProduct = appliedQuantityByProduct(newPositions, newApplicable);
  const productIds = [...new Set([...oldByProduct.keys(), ...newByProduct.keys()])];

  for (const productId of productIds) {
    const oldQty = oldByProduct.get(productId) ?? 0;
    const newQty = newByProduct.get(productId) ?? 0;
    const deltaApplied = newQty - oldQty;
    if (Math.abs(deltaApplied) < 0.0001) continue;

    const current = await tx.localStockBalance.findUnique({
      where: { productId_storeId: { productId, storeId } },
    });
    const currentQuantity = current?.quantity.toNumber() ?? 0;
    const reserve = current?.reserve.toNumber() ?? 0;
    const currentAvailable = currentQuantity - reserve;
    if (deltaApplied > currentAvailable + 0.0001) {
      throw new Error("Недостаточно остатков для проведения отгрузки");
    }
    const nextQuantity = currentQuantity - deltaApplied;
    const nextAvailable = nextQuantity - reserve;

    if (current) {
      await tx.localStockBalance.update({
        where: { id: current.id },
        data: {
          quantity: new Prisma.Decimal(nextQuantity),
          available: new Prisma.Decimal(nextAvailable),
          syncedAt: new Date(),
        },
      });
    } else {
      await tx.localStockBalance.create({
        data: {
          productId,
          storeId,
          quantity: new Prisma.Decimal(nextQuantity),
          reserve: new Prisma.Decimal(0),
          available: new Prisma.Decimal(nextAvailable),
          syncedAt: new Date(),
        },
      });
    }
  }
}

async function findLocalDemand(id: string) {
  return prisma.localDemand.findFirst({
    where: { OR: [{ id }, { moyskladId: id }] },
    include: { positions: true, counterparty: true, store: true, organization: true },
  });
}

export async function createLocalDemand(
  body: CreateDemandBody,
  options?: { ecoUserName?: string }
): Promise<{ ok: true; id: string; name: string; href: string } | { ok: false; error: string }> {
  const storeMoyskladId = entityIdFromMeta(body.store?.meta);
  const agentMoyskladId = entityIdFromMeta(body.agent?.meta);
  const organizationLookupId = entityIdFromMeta(body.organization?.meta);
  const [store, counterparty, organization] = await Promise.all([
    storeMoyskladId
      ? prisma.localStore.findFirst({ where: { OR: [{ id: storeMoyskladId }, { moyskladId: storeMoyskladId }] } })
      : null,
    agentMoyskladId
      ? prisma.localCounterparty.findFirst({ where: { OR: [{ id: agentMoyskladId }, { moyskladId: agentMoyskladId }] } })
      : null,
    organizationLookupId
      ? prisma.localOrganization.findFirst({ where: { OR: [{ id: organizationLookupId }, { moyskladId: organizationLookupId }] } })
      : null,
  ]);

  if (!organization) return { ok: false, error: "Организация не найдена в локальной БД. Запустите импорт или seed." };
  if (!store) return { ok: false, error: "Склад не найден в локальной БД. Запустите импорт складского зеркала." };
  if (!counterparty) {
    return { ok: false, error: "Контрагент не найден в локальной БД. Запустите импорт или выберите импортированного контрагента." };
  }

  const { documentDate, momentAt } = parseMoment(body.moment);
  const positions = await resolveCreatePositions(body.positions, store.id);
  const name = body.name?.trim() || (await nextLocalDemandName(documentDate));
  const raw = { ...body, ecoUserName: options?.ecoUserName ?? null };
  const applicable = body.applicable ?? false;
  const localAttributes = await buildLocalDemandAttributes(body.attributes, options?.ecoUserName);

  let demand: Awaited<ReturnType<typeof prisma.localDemand.create>>;
  try {
    demand = await prisma.$transaction(async (tx) => {
    const created = await tx.localDemand.create({
      data: {
        name,
        moyskladHref: null,
        momentAt,
        documentDate,
        applicable,
        sumCents: sumPositionsCents(positions),
        description: body.description?.trim() || null,
        counterpartyId: counterparty.id,
        agentMoyskladId,
        agentNameSnapshot: counterparty.name,
        storeId: store.id,
        storeMoyskladId,
        storeNameSnapshot: store.name,
        organizationId: organization.id,
        organizationName: organization.name,
        attributes: toJson(localAttributes),
        raw: toJson(raw),
        syncedAt: new Date(),
      },
    });

    if (positions.length > 0) {
      await tx.localDemandPosition.createMany({
        data: positions.map((position) => ({
          demandId: created.id,
          productId: position.productId,
          assortmentMoyskladId: position.assortmentMoyskladId,
          assortmentType: position.assortmentType,
          name: position.name,
          quantity: position.quantity,
          priceCentsPerUnit: position.priceCentsPerUnit,
          discount: position.discount,
          vat: position.vat,
          vatEnabled: position.vatEnabled,
          buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
          slotName: position.slotName,
          raw: position.raw,
        })),
      });
    }

    await applyStockMovements(tx, store.id, [], false, positions, applicable);
    return created;
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось создать локальную отгрузку" };
  }

  invalidateWarehouseReadCaches();
  invalidateDemandListCache();
  return { ok: true, id: demand.id, name: demand.name, href: `local://demand/${demand.id}` };
}

export async function updateLocalDemand(
  id: string,
  body: UpdateDemandBody
): Promise<{ ok: true; id: string; name: string; applicable: boolean; description: string } | { ok: false; error: string; notFound?: boolean }> {
  const current = await findLocalDemand(id);
  if (!current) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };

  const storeLookupId = entityIdFromMeta(body.store?.meta);
  const agentLookupId = entityIdFromMeta(body.agent?.meta);
  const organizationLookupId = entityIdFromMeta(body.organization?.meta);
  const [nextStore, nextCounterparty, nextOrganization] = await Promise.all([
    storeLookupId
      ? prisma.localStore.findFirst({ where: { OR: [{ id: storeLookupId }, { moyskladId: storeLookupId }] } })
      : current.store,
    agentLookupId
      ? prisma.localCounterparty.findFirst({ where: { OR: [{ id: agentLookupId }, { moyskladId: agentLookupId }] } })
      : current.counterparty,
    organizationLookupId
      ? prisma.localOrganization.findFirst({ where: { OR: [{ id: organizationLookupId }, { moyskladId: organizationLookupId }] } })
      : current.organization,
  ]);

  if (body.store?.meta && !nextStore) return { ok: false, error: "Склад не найден в локальной БД" };
  if (body.agent?.meta && !nextCounterparty) return { ok: false, error: "Контрагент не найден в локальной БД" };
  if (body.organization?.meta && !nextOrganization) return { ok: false, error: "Организация не найдена в локальной БД" };

  const existingById = new Map(
    current.positions.map((position) => [
      position.id,
      {
        productId: position.productId,
        assortmentType: position.assortmentType,
        quantity: position.quantity,
        name: position.name,
        buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
      },
    ])
  );

  const nextPositions = Array.isArray(body.positions)
    ? await resolveUpdatePositions(body.positions, existingById)
    : current.positions.map((position) => ({
        id: position.id,
        productId: position.productId,
        assortmentMoyskladId: position.assortmentMoyskladId,
        assortmentType: position.assortmentType,
        name: position.name,
        quantity: position.quantity,
        priceCentsPerUnit: position.priceCentsPerUnit,
        discount: position.discount,
        vat: position.vat,
        vatEnabled: position.vatEnabled,
        buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
        slotName: position.slotName,
        raw: toJson(position.raw),
      }));
  const nextApplicable = typeof body.applicable === "boolean" ? body.applicable : current.applicable;
  const nextDescription = typeof body.description === "string" ? body.description.trim() : current.description;
  const nextName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
  const nextMoment = body.moment ? parseMoment(body.moment) : { documentDate: current.documentDate, momentAt: current.momentAt };
  const nextStoreId = nextStore?.id ?? current.storeId;
  const storeChanged = Boolean(nextStoreId && nextStoreId !== current.storeId);

  const updated = await prisma.$transaction(async (tx) => {
    if (storeChanged) {
      await applyStockMovements(tx, current.storeId, current.positions, current.applicable, [], false);
      await applyStockMovements(tx, nextStoreId, [], false, nextPositions, nextApplicable);
    } else {
      await applyStockMovements(
        tx,
        current.storeId,
        current.positions,
        current.applicable,
        nextPositions,
        nextApplicable
      );
    }

    if (Array.isArray(body.positions)) {
      await tx.localDemandPosition.deleteMany({ where: { demandId: current.id } });
      if (nextPositions.length > 0) {
        await tx.localDemandPosition.createMany({
          data: nextPositions.map((position) => ({
            demandId: current.id,
            productId: position.productId,
            assortmentMoyskladId: position.assortmentMoyskladId,
            assortmentType: position.assortmentType,
            name: position.name,
            quantity: position.quantity,
            priceCentsPerUnit: position.priceCentsPerUnit,
            discount: position.discount,
            vat: position.vat,
            vatEnabled: position.vatEnabled,
            buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
            slotName: position.slotName,
            raw: position.raw,
          })),
        });
      }
    }

    return tx.localDemand.update({
      where: { id: current.id },
      data: {
        name: nextName,
        momentAt: nextMoment.momentAt,
        documentDate: nextMoment.documentDate,
        applicable: nextApplicable,
        description: nextDescription || null,
        counterpartyId: nextCounterparty?.id ?? current.counterpartyId,
        agentMoyskladId: nextCounterparty ? nextCounterparty.moyskladId ?? nextCounterparty.id : current.agentMoyskladId,
        agentNameSnapshot: nextCounterparty?.name ?? current.agentNameSnapshot,
        storeId: nextStore?.id ?? current.storeId,
        storeMoyskladId: nextStore ? nextStore.moyskladId ?? nextStore.id : current.storeMoyskladId,
        storeNameSnapshot: nextStore?.name ?? current.storeNameSnapshot,
        organizationId: nextOrganization?.id ?? current.organizationId,
        organizationName: nextOrganization?.name ?? current.organizationName,
        attributes: Array.isArray(body.attributes) ? toJson(body.attributes) : current.attributes ?? Prisma.JsonNull,
        sumCents: sumPositionsCents(nextPositions),
        raw: toJson({ ...(typeof current.raw === "object" && current.raw ? current.raw : {}), lastLocalUpdate: new Date().toISOString() }),
        syncedAt: new Date(),
      },
    });
  });

  invalidateWarehouseReadCaches();
  invalidateDemandListCache();
  return {
    ok: true,
    id: updated.id,
    name: updated.name,
    applicable: updated.applicable,
    description: updated.description ?? "",
  };
}

export async function deleteLocalDemand(
  id: string
): Promise<{ ok: true } | { ok: false; error: string; notFound?: boolean }> {
  const current = await findLocalDemand(id);
  if (!current) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };

  await prisma.$transaction(async (tx) => {
    await applyStockMovements(tx, current.storeId, current.positions, current.applicable, [], false);
    await tx.localDemand.delete({ where: { id: current.id } });
  });

  invalidateWarehouseReadCaches();
  invalidateDemandListCache();
  return { ok: true };
}

export async function loadLocalDemandDetailPayload(
  id: string
): Promise<{ ok: true; data: DemandDetailPayload } | { ok: false; error: string; notFound?: boolean }> {
  const demand = await prisma.localDemand.findFirst({
    where: { OR: [{ id }, { moyskladId: id }] },
    include: {
      counterparty: true,
      store: true,
      organization: true,
      positions: { include: { product: true }, orderBy: { id: "asc" } },
    },
  });
  if (!demand) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };

  const positions: DemandDetailPosition[] = demand.positions.map((position) => {
    const assortmentMeta = position.product
      ? entityMeta(position.product.entityType, position.product.moyskladId, position.product.moyskladHref, position.product.id)
      : position.assortmentMoyskladId
        ? moyskladMeta(position.assortmentType, position.assortmentMoyskladId, null)
        : undefined;
    return {
      id: position.id,
      name: position.name,
      quantity: position.quantity.toNumber(),
      price: position.priceCentsPerUnit,
      slotName: position.slotName ?? "",
      discount: position.discount.toNumber(),
      stock: {
        cost: position.buyPriceCentsPerUnit ?? undefined,
      },
      assortmentMeta,
    };
  });

  if (demand.storeId) {
    const balances = await prisma.localStockBalance.findMany({
      where: {
        storeId: demand.storeId,
        productId: { in: demand.positions.map((position) => position.productId).filter((value): value is string => Boolean(value)) },
      },
    });
    const balanceByProduct = new Map(balances.map((balance) => [balance.productId, balance]));
    positions.forEach((position, index) => {
      const source = demand.positions[index];
      const balance = source?.productId ? balanceByProduct.get(source.productId) : null;
      if (!balance) return;
      position.stock = {
        ...position.stock,
        quantity: balance.quantity.toNumber(),
        reserve: balance.reserve.toNumber(),
        available: balance.available.toNumber(),
      };
      if (!position.slotName && balance.slotName) position.slotName = balance.slotName;
    });
  }

  const currentAttributes = Array.isArray(demand.attributes)
    ? (demand.attributes as Array<{ definitionId?: string; id?: string; name?: string; type?: string; value?: unknown }>)
    : [];
  const currentById = new Map<string, (typeof currentAttributes)[number]>();
  const currentByName = new Map<string, (typeof currentAttributes)[number]>();
  for (const attr of currentAttributes) {
    const id = attr.definitionId ?? attr.id ?? "";
    if (id) currentById.set(id, attr);
    if (attr.name) currentByName.set(normalizeAttributeName(attr.name), attr);
  }

  const metaRes = await ensureDemandAttributeMetadata();
  const attributes: DemandDetailAttribute[] = metaRes.ok && metaRes.attributes.length > 0
    ? metaRes.attributes.map((definition) => {
        const current = currentById.get(definition.id) ?? currentByName.get(normalizeAttributeName(definition.name));
        return {
          id: definition.id,
          name: definition.name,
          type: definition.type,
          meta: definition.meta,
          value: current?.value ?? null,
        };
      })
    : currentAttributes.map((attr) => {
        const id = attr.definitionId ?? attr.id ?? attr.name ?? "";
        return {
          id,
          name: attr.name ?? id,
          type: attr.type ?? "string",
          meta: localMeta("demand-attribute", id),
          value: attr.value ?? null,
        };
      });
  const agentMeta = demand.counterparty
    ? entityMeta("counterparty", demand.counterparty.moyskladId, demand.counterparty.moyskladHref, demand.counterparty.id)
    : demand.agentMoyskladId
      ? moyskladMeta("counterparty", demand.agentMoyskladId, null)
      : undefined;
  const storeMeta = demand.store
    ? entityMeta("store", demand.store.moyskladId, demand.store.moyskladHref, demand.store.id)
    : demand.storeMoyskladId
      ? moyskladMeta("store", demand.storeMoyskladId, null)
      : undefined;
  const organizationMeta = demand.organization
    ? entityMeta("organization", demand.organization.moyskladId, demand.organization.moyskladHref, demand.organization.id)
    : undefined;

  const data: DemandDetailPayload = {
    header: {
      id: demand.id,
      name: demand.name,
      moment: demand.momentAt.toISOString(),
      applicable: demand.applicable,
      description: demand.description ?? "",
      sum: demand.sumCents,
      href: `local://demand/${demand.id}`,
      agentName: demand.counterparty?.name ?? demand.agentNameSnapshot ?? "",
      organizationName: demand.organization?.name ?? demand.organizationName ?? "",
      storeName: demand.store?.name ?? demand.storeNameSnapshot ?? "",
      storeId: demand.store?.moyskladId ?? demand.store?.id ?? demand.storeMoyskladId ?? "",
      ecoUserName: undefined,
    },
    attributes,
    positions,
    raw: {
      id: demand.id,
      meta: localMeta("demand", demand.id),
      agent: demand.counterparty
        ? {
            id: demand.counterparty.moyskladId ?? demand.counterparty.id,
            name: demand.counterparty.name,
            phone: demand.counterparty.phone ?? undefined,
            phones: Array.isArray(demand.counterparty.phonesRaw)
              ? (demand.counterparty.phonesRaw as unknown[]).map((phone) => ({ phone: String(phone ?? "") }))
              : undefined,
            meta: agentMeta,
          }
        : undefined,
      store: demand.store ? { id: demand.store.moyskladId ?? demand.store.id, name: demand.store.name, meta: storeMeta } : undefined,
      organization: demand.organization?.name || demand.organizationName
        ? {
            id: demand.organization?.moyskladId ?? demand.organization?.id,
            name: demand.organization?.name ?? demand.organizationName ?? "",
            meta: organizationMeta,
          }
        : undefined,
    },
    rawPositions: positions.map((position) => ({
      id: position.id,
      quantity: position.quantity,
      price: position.price,
      discount: position.discount,
      assortment: { name: position.name, meta: position.assortmentMeta },
    })),
  };

  return { ok: true, data };
}
