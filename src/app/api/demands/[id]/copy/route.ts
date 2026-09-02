import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { type CreateDemandBody, type DemandPositionInput } from "@/lib/demand-create-payload";
import { prisma } from "@/lib/db";
import { createLocalDemand, loadLocalDemandDetailPayload } from "@/lib/local-demand-write";
import { extractLocalEntityId } from "@/lib/piecework-rules";
import { toServiceMomentString } from "@/lib/time";
import type { Prisma } from "@prisma/client";

type CopyProduct = Prisma.LocalProductGetPayload<{ include: { stockBalances: true } }>;
type CopyMetaStatus = "linked" | "updated" | "unlinked" | "ambiguous" | "archived" | "one_off_price_check";

function normalizeLookup(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function decimalToNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productMeta(product: CopyProduct) {
  return {
    href: `local://${product.entityType || "product"}/${product.id}`,
    type: product.entityType || "product",
    mediaType: "application/json",
  };
}

function stockSnapshot(product: CopyProduct) {
  const balance = product.stockBalances[0];
  return {
    quantity: decimalToNumber(balance?.quantity),
    reserve: decimalToNumber(balance?.reserve),
    available: decimalToNumber(balance?.available),
    slotName: balance?.slotName ?? product.cell ?? null,
    buyPriceCents: balance?.buyPriceCents ?? null,
  };
}

function buildCopyMeta(params: {
  status: CopyMetaStatus;
  originalName: string;
  originalPriceCents: number;
  currentPriceCents: number;
  product?: CopyProduct | null;
  message?: string;
}) {
  const stock = params.product ? stockSnapshot(params.product) : null;
  return {
    source: "shipment-copy",
    status: params.status,
    message: params.message,
    originalName: params.originalName,
    currentName: params.product?.name ?? params.originalName,
    originalPriceCents: params.originalPriceCents,
    currentPriceCents: params.currentPriceCents,
    priceUpdated: params.originalPriceCents !== params.currentPriceCents,
    productId: params.product?.id ?? null,
    archived: params.product?.archived ?? false,
    slotName: stock?.slotName ?? null,
    stock: stock
      ? {
          quantity: stock.quantity,
          reserve: stock.reserve,
          available: stock.available,
          buyPriceCents: stock.buyPriceCents,
        }
      : null,
  };
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id?.trim()) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  return runWithBranchApiContext(branchAccess.context, async () => {
    try {
    const loaded = await loadLocalDemandDetailPayload(id.trim(), branchAccess.context.branchId!);
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.notFound ? 404 : 400 });

    const raw = loaded.data.raw as {
      organization?: { meta?: { href: string; type: string; mediaType: string } };
      agent?: { meta?: { href: string; type: string; mediaType: string } };
      store?: { meta?: { href: string; type: string; mediaType: string } };
    };

    const fallbackOrganization = raw.organization?.meta
      ? null
      : await prisma.localOrganization.findFirst({
          where: { isActive: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        });
    const orgM = raw.organization?.meta ?? (fallbackOrganization
      ? {
          href: `local://organization/${fallbackOrganization.id}`,
          type: "organization",
          mediaType: "application/json",
        }
      : undefined);
    const agentM = raw.agent?.meta;
    const storeM = raw.store?.meta;
    if (!orgM?.href || !agentM?.href || !storeM?.href) {
      return NextResponse.json(
        { error: "В отгрузке нет организации, контрагента или склада — копирование невозможно" },
        { status: 400 }
      );
    }

    const moment = toServiceMomentString();
    const storeLookupId = extractLocalEntityId(storeM.href);
    const localStore = storeLookupId
      ? await prisma.localStore.findFirst({
          where: {
            id: storeLookupId,
          },
          select: { id: true },
        })
      : null;
    const sourcePositions = loaded.data.positions;
    const assortmentIds = [...new Set(sourcePositions
      .map((position) => extractLocalEntityId(position.assortmentMeta?.href))
      .filter((value): value is string => Boolean(value)))];
    const sourceNames = [...new Set(sourcePositions.map((position) => position.name.trim()).filter(Boolean))];
    const productWhere: Prisma.LocalProductWhereInput[] = [];
    if (assortmentIds.length > 0) productWhere.push({ id: { in: assortmentIds } });
    if (sourceNames.length > 0) {
      productWhere.push({
        OR: sourceNames.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })),
      });
    }
    const catalogProducts = productWhere.length > 0
      ? await prisma.localProduct.findMany({
          where: { OR: productWhere },
          include: {
            stockBalances: {
              where: localStore?.id ? { storeId: localStore.id } : undefined,
              take: localStore?.id ? 1 : 20,
            },
          },
        })
      : [];
    const productById = new Map<string, CopyProduct>();
    const productsByName = new Map<string, CopyProduct[]>();
    for (const product of catalogProducts) {
      productById.set(product.id, product);
      const nameKey = normalizeLookup(product.name);
      if (nameKey) productsByName.set(nameKey, [...(productsByName.get(nameKey) ?? []), product]);
    }

    const positions: DemandPositionInput[] = sourcePositions.map((position) => {
      const originalPriceCents = Math.round(Number(position.price) || 0);
      const quantity = Number(position.quantity) || 1;
      const discount = typeof position.discount === "number" ? position.discount : 0;
      if (position.lineKind === "nonstock_product" && position.oneOffProduct) {
        return {
          name: position.name,
          quantity,
          price: originalPriceCents / 100,
          discount,
          vat: 0,
          vatEnabled: false,
          lineKind: "nonstock_product",
          oneOffProduct: {
            groupCode: position.oneOffProduct.groupCode,
            brand: position.oneOffProduct.brandCanonical || position.oneOffProduct.brand,
            article: position.oneOffProduct.articleDisplay || position.oneOffProduct.article,
            uomCode: position.oneOffProduct.uomCode,
            purchasePrice: position.oneOffProduct.purchasePrice,
            explicitZeroCost: position.oneOffProduct.explicitZeroCost,
            purchaseSourceId: position.oneOffProduct.purchaseSourceId,
            purchaseSourceLabel: position.oneOffProduct.purchaseSourceLabel,
            clarification: position.oneOffProduct.clarification,
          },
          copyMeta: {
            source: "shipment-copy",
            status: "one_off_price_check",
            message: "Закупочная цена взята из предыдущей отгрузки. Проверьте актуальность.",
            originalName: position.name,
            originalPriceCents,
            currentPriceCents: originalPriceCents,
            priceUpdated: false,
            productId: null,
          },
        };
      }
      if (position.lineKind === "one_off_service" && position.oneOffService) {
        return {
          name: position.name,
          assortment: { meta: { href: `local://manual-service/${crypto.randomUUID()}`, type: "service", mediaType: "application/json" } },
          quantity,
          price: originalPriceCents / 100,
          discount,
          vat: 0,
          vatEnabled: false,
          lineKind: "one_off_service",
          oneOffService: position.oneOffService,
          copyMeta: {
            source: "shipment-copy",
            status: "linked",
            message: "Структурированная категория разовой услуги сохранена.",
            originalName: position.name,
            originalPriceCents,
            currentPriceCents: originalPriceCents,
            priceUpdated: false,
            productId: null,
          },
        };
      }
      const assortmentId = extractLocalEntityId(position.assortmentMeta?.href);
      const byId = assortmentId ? productById.get(assortmentId) : undefined;
      const exactByName = productsByName.get(normalizeLookup(position.name)) ?? [];
      const activeExact = exactByName.filter((product) => !product.archived);
      const matched = byId ?? (activeExact.length === 1 ? activeExact[0] : exactByName.length === 1 ? exactByName[0] : undefined);
      const ambiguous = !byId && activeExact.length > 1;

      if (matched && !matched.archived && !ambiguous) {
        const currentPriceCents = matched.salePriceCents;
        const status: CopyMetaStatus = currentPriceCents !== originalPriceCents ? "updated" : "linked";
        return {
          name: matched.name,
          assortment: { meta: productMeta(matched) },
          quantity,
          price: currentPriceCents / 100,
          discount,
          vat: 0,
          vatEnabled: false,
          copyMeta: buildCopyMeta({
            status,
            originalName: position.name,
            originalPriceCents,
            currentPriceCents,
            product: matched,
            message: status === "updated" ? "Цена обновлена из локального каталога" : "Позиция связана с локальным каталогом",
          }),
        };
      }

      const status: CopyMetaStatus = ambiguous ? "ambiguous" : matched?.archived ? "archived" : "unlinked";
      const message =
        status === "ambiguous"
          ? "Найдено несколько совпадений в каталоге"
          : status === "archived"
            ? "Товар в архиве"
            : "Не связан с каталогом";
      return {
        name: position.name,
        quantity,
        price: originalPriceCents / 100,
        discount,
        vat: 0,
        vatEnabled: false,
        copyMeta: buildCopyMeta({
          status,
          originalName: position.name,
          originalPriceCents,
          currentPriceCents: originalPriceCents,
          product: matched ?? null,
          message,
        }),
      };
    });

    const body: CreateDemandBody = {
      organization: { meta: orgM },
      agent: { meta: agentM },
      store: { meta: storeM },
      description: loaded.data.header.description?.trim() || undefined,
      applicable: false,
      moment,
      attributes: loaded.data.attributes.map((a) => ({
        id: a.id,
        name: a.name,
        meta: a.meta,
        value: a.value as string | number | boolean | null | unknown,
      })),
      positions: positions.length > 0 ? positions : undefined,
    };

    const created = await createLocalDemand(body, {
      ecoUserName: session.user.name || session.user.login,
      branchId: branchAccess.context.branchId!,
      organizationId: branchAccess.context.organizationId!,
    });
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
    return NextResponse.json({ ok: true, id: created.id, name: created.name, href: created.href });
    } catch (error) {
      console.error("[api/demands/copy] failed:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Не удалось скопировать отгрузку" },
        { status: 500 }
      );
    }
  });
}
