import { Prisma, type LocalStockBalance } from "@prisma/client";
import { prisma } from "@/lib/db";
import { calculateKit, validateKitInput } from "@/lib/product-kit-calculation";

export class KitError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function kitStore(branchId: string, requested?: string | null) {
  const store = await prisma.localStore.findFirst({
    where: { branchId, archived: false, ...(requested ? { id: requested } : {}) },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  if (!store) throw new KitError(requested ? "Склад недоступен в выбранном филиале" : "В филиале нет действующего склада");
  return store;
}

const kitInclude = {
  items: { orderBy: { position: "asc" as const }, include: { product: true } },
  targets: true,
} satisfies Prisma.ProductKitInclude;
type KitRecord = Prisma.ProductKitGetPayload<{ include: typeof kitInclude }>;

export async function kitViews(branchId: string, storeId: string, kits: KitRecord[], suppliedBalances?: LocalStockBalance[]) {
  const productIds = [...new Set(kits.flatMap((kit) => kit.items.map((item) => item.productId)))];
  const balances = suppliedBalances ?? (productIds.length ? await prisma.localStockBalance.findMany({ where: { branchId, storeId, productId: { in: productIds } } }) : []);
  const stocks = new Map(balances.map((balance) => [balance.productId, balance]));
  return kits.map((kit) => {
    const summary = calculateKit(kit.items.map((item) => ({
      productId: item.productId, quantity: Number(item.quantity),
      available: Number(stocks.get(item.productId)?.available ?? 0),
      priceCents: item.product.salePriceCents,
      blocked: item.product.archived || !["product", "variant"].includes(item.product.entityType),
    })), kit.targets.find((target) => target.storeId === storeId)?.quantity ?? 0);
    return {
      id: kit.id, branchId, storeId, name: kit.name, version: kit.version, archived: kit.archived,
      ...summary,
      items: summary.items.map((item, index) => {
        const product = kit.items[index].product;
        const stock = stocks.get(item.productId);
        return {
          ...item, name: product.name, article: product.article ?? "", unit: product.uomName ?? "шт.",
          product: {
            id: product.id, name: product.name, price: product.salePriceCents / 100,
            currency: product.currencyName ?? "руб.",
            meta: { href: `local://${product.entityType}/${product.id}`, type: product.entityType, mediaType: "application/json" },
            stockQuantity: Number(stock?.quantity ?? 0), reserveQuantity: Number(stock?.reserve ?? 0),
            availableQuantity: Number(stock?.available ?? 0), cost: stock?.buyPriceCents != null ? stock.buyPriceCents / 100 : undefined,
            cell: product.cell ?? undefined, slotName: stock?.slotName ?? product.cell ?? undefined,
            uomName: product.uomName ?? undefined, groupPath: product.groupPath ?? undefined,
            packageVolume: product.packageVolume ?? undefined, volume: product.volume != null ? Number(product.volume) : null,
          },
        };
      }),
    };
  });
}

export async function listKits(branchId: string, input: { storeId?: string | null; q?: string; page?: number; archived?: boolean }) {
  const store = await kitStore(branchId, input.storeId);
  const where = { branchId, archived: input.archived ?? false, ...(input.q ? { name: { contains: input.q.slice(0, 200), mode: "insensitive" as const } } : {}) };
  const page = Math.max(0, input.page ?? 0);
  const [kits, total] = await Promise.all([
    prisma.productKit.findMany({ where, include: kitInclude, orderBy: [{ name: "asc" }, { id: "asc" }], skip: page * 30, take: 30 }),
    prisma.productKit.count({ where }),
  ]);
  return { kits: await kitViews(branchId, store.id, kits), store, total };
}

export async function readKit(branchId: string, id: string, storeId?: string | null) {
  const store = await kitStore(branchId, storeId);
  const kit = await prisma.productKit.findFirst({ where: { branchId, id }, include: kitInclude });
  if (!kit) throw new KitError("Комплект не найден", 404);
  return { kit: (await kitViews(branchId, store.id, [kit]))[0], store };
}

export async function saveKit(branchId: string, raw: unknown, id?: string) {
  let input: ReturnType<typeof validateKitInput>;
  try { input = validateKitInput(raw); }
  catch (error) { throw new KitError(error instanceof Error ? error.message : "Неверные данные комплекта"); }
  const version = (raw as { version?: unknown }).version;
  if (id && (!Number.isSafeInteger(version) || Number(version) < 1)) throw new KitError("Обновите карточку комплекта перед сохранением");
  return prisma.$transaction(async (tx) => {
    const products = await tx.localProduct.findMany({ where: { branchId, id: { in: input.items.map((item) => item.productId) }, archived: false, entityType: { in: ["product", "variant"] } }, select: { id: true } });
    if (products.length !== input.items.length) throw new KitError("В составе есть архивные или недоступные товары. Выберите действующие товары текущего филиала");
    let kitId = id;
    if (kitId) {
      const updated = await tx.productKit.updateMany({ where: { branchId, id: kitId, version: Number(version), archived: false }, data: { name: input.name, version: { increment: 1 } } });
      if (!updated.count) throw new KitError("Комплект изменён или архивирован. Обновите список перед сохранением", 409);
      await tx.productKitItem.deleteMany({ where: { branchId, kitId } });
    } else {
      kitId = (await tx.productKit.create({ data: { branchId, name: input.name } })).id;
    }
    await tx.productKitItem.createMany({ data: input.items.map((item, position) => ({ branchId, kitId: kitId!, ...item, position })) });
    return { id: kitId };
  });
}

export async function updateKitState(branchId: string, id: string, body: Record<string, unknown>) {
  if (body.action === "target") {
    if (typeof body.storeId !== "string" || !body.storeId) throw new KitError("Выберите склад");
    if (typeof body.quantity !== "number" || !Number.isSafeInteger(body.quantity) || body.quantity < 0 || body.quantity > 1_000_000) throw new KitError("Запас должен быть целым числом от 0 до 1 000 000");
    const store = await kitStore(branchId, body.storeId);
    return prisma.$transaction(async (tx) => {
      if (!await tx.productKit.findFirst({ where: { branchId, id, archived: false }, select: { id: true } })) throw new KitError("Комплект не найден", 404);
      return tx.productKitStockTarget.upsert({
        where: { branchId_kitId_storeId: { branchId, kitId: id, storeId: store.id } },
        create: { branchId, kitId: id, storeId: store.id, quantity: body.quantity as number },
        update: { quantity: body.quantity as number },
      });
    });
  }
  if (body.action === "archive" || body.action === "restore") {
    if (!Number.isSafeInteger(body.version)) throw new KitError("Обновите карточку комплекта");
    const result = await prisma.productKit.updateMany({ where: { branchId, id, version: Number(body.version) }, data: { archived: body.action === "archive", version: { increment: 1 } } });
    if (!result.count) throw new KitError("Комплект изменён. Обновите список", 409);
    return { ok: true };
  }
  return saveKit(branchId, body, id);
}

export type ProductKitView = Awaited<ReturnType<typeof readKit>>["kit"];
