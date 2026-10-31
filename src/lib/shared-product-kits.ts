import { randomUUID } from "node:crypto";
import { Prisma, type SharedProductKit } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { BranchContext } from "@/lib/branch-context";
import { runWithBranchApiContext } from "@/lib/branch-api";
import { getRequestTenant } from "@/lib/request-tenant-store";
import { calculateKit, validateKitInput } from "@/lib/product-kit-calculation";
import { KitError, kitStore, type ProductKitView } from "@/lib/product-kits";
import { assertKitBinding, kitProductIdentity, readKitTemplateItems, resolveKitProduct, kitIdentitySignature, type KitTemplateItem } from "@/lib/shared-product-kit-model";

const productSelect = {
  id: true, branchId: true, name: true, article: true, brand: true, uomName: true,
  packageVolume: true, volume: true, weight: true, modificationCode: true,
  entityType: true, archived: true, salePriceCents: true, priceNeedsSetup: true,
  currencyName: true, groupPath: true, cell: true,
} satisfies Prisma.LocalProductSelect;
type Product = Prisma.LocalProductGetPayload<{ select: typeof productSelect }>;
type Balance = { productId: string; storeId: string; branchId: string; available: unknown; quantity: unknown; reserve: unknown; buyPriceCents: number | null; slotName: string | null };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function groupId(branchId?: string) {
  const tenant = getRequestTenant();
  if (!tenant?.businessGroupId || tenant.mode === "denied" || (branchId && (tenant.mode !== "branch" || tenant.branchId !== branchId))) throw new KitError("Нет доступа к общим комплектам", 403);
  return tenant.businessGroupId;
}

function writeGroupId(branchId: string) {
  const id = groupId(branchId);
  const roles = getRequestTenant()?.permissions || [];
  if (!canWriteRoles(roles)) throw new KitError("Недостаточно прав для изменения общего комплекта", 403);
  return id;
}

function canWriteRoles(roles: string[]) {
  return !roles.includes("group_analyst") && roles.some((role) => ["group_owner", "group_admin", "branch_owner", "administrator", "master"].includes(role));
}

function canManage(context: BranchContext) {
  if (context.mode !== "branch" || context.branch?.status !== "active") return false;
  return context.groupRole ? ["group_owner", "group_admin"].includes(context.groupRole) : ["branch_owner", "administrator", "master"].includes(context.branchRole || "");
}

export function sharedKitSignature(name: string, items: KitTemplateItem[]) {
  return JSON.stringify([name.trim().normalize("NFKC").toLocaleUpperCase("ru-RU"), items.map((item) => [kitIdentitySignature(item.identity) || JSON.stringify(Object.entries(item.bindings).sort()), item.quantity]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

async function findKit(id: string, businessGroupId: string) {
  const row = await prisma.sharedProductKit.findFirst({ where: { businessGroupId, OR: [{ id }, { legacyIds: { array_contains: [id] } }] } });
  if (!row) throw new KitError("Комплект не найден", 404);
  return row;
}

async function productsFor(items: KitTemplateItem[], branchIds: string[]) {
  const ids = [...new Set(items.flatMap((item) => Object.values(item.bindings)))];
  const articles = [...new Set(items.map((item) => item.identity.article).filter(Boolean))];
  return prisma.localProduct.findMany({ where: { branchId: { in: branchIds }, OR: [{ id: { in: ids } }, { article: { in: articles } }] }, select: productSelect });
}

export function sharedKitView(row: SharedProductKit, branchId: string, storeId: string, products: Product[], balances: Balance[]): ProductKitView {
  const items = readKitTemplateItems(row.items);
  const resolved = items.map((item) => ({ item, ...resolveKitProduct(item, branchId, products) }));
  // Two template components may not consume the same local product independently.
  const repeated = new Set(resolved.filter((entry, index, list) => entry.product && list.some((other, otherIndex) => otherIndex !== index && other.product?.id === entry.product?.id)).map((entry) => entry.product!.id));
  const stock = new Map(balances.filter((balance) => balance.branchId === branchId && balance.storeId === storeId).map((balance) => [balance.productId, balance]));
  const summary = calculateKit(resolved.map(({ item, product }) => ({ productId: product?.id || `unmapped:${item.id}`, quantity: item.quantity, available: Number(product ? stock.get(product.id)?.available ?? 0 : 0), priceCents: product?.salePriceCents ?? 0, blocked: !product || repeated.has(product.id) })), targetFor(row.targets, storeId));
  return {
    id: row.id, branchId, storeId, name: row.name, version: row.version, archived: row.archived, shared: true,
    canManage: getRequestTenant()?.mode === "branch" && canWriteRoles(getRequestTenant()?.permissions || []),
    ...summary,
    priceComplete: resolved.every(({ product }) => product && !product.priceNeedsSetup) && repeated.size === 0,
    items: summary.items.map((line, index) => {
      const { item, product, issue } = resolved[index];
      const balance = product ? stock.get(product.id) : undefined;
      return {
        ...line, templateItemId: item.id, mappingIssue: repeated.has(product?.id || "") ? "Одна карточка назначена двум позициям" : issue,
        name: product?.name || item.identity.name, article: product?.article || item.identity.article, unit: product?.uomName || item.identity.uomName || "шт.",
        product: {
          id: product?.id || "", name: product?.name || item.identity.name, price: (product?.salePriceCents ?? 0) / 100,
          currency: product?.currencyName || "руб.", meta: { href: product ? `local://${product.entityType}/${product.id}` : "", type: product?.entityType || "product", mediaType: "application/json" },
          stockQuantity: Number(balance?.quantity ?? 0), reserveQuantity: Number(balance?.reserve ?? 0), availableQuantity: Number(balance?.available ?? 0),
          cost: balance?.buyPriceCents != null ? balance.buyPriceCents / 100 : undefined,
          cell: product?.cell || undefined, slotName: balance?.slotName || product?.cell || undefined,
          uomName: product?.uomName || undefined, groupPath: product?.groupPath || undefined, packageVolume: product?.packageVolume || undefined, volume: product?.volume != null ? Number(product.volume) : null,
        },
      };
    }),
  };
}

function targetFor(value: unknown, storeId: string): number {
  const targets = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const target = targets[storeId];
  return typeof target === "number" && Number.isSafeInteger(target) && target >= 0 ? target : 0;
}

export async function readSharedKit(branchId: string, id: string, storeId?: string | null) {
  const businessGroupId = groupId(branchId);
  const store = await kitStore(branchId, storeId);
  const row = await findKit(id, businessGroupId);
  const products = await productsFor(readKitTemplateItems(row.items), [branchId]);
  const balances = products.length ? await prisma.localStockBalance.findMany({ where: { branchId, storeId: store.id, productId: { in: products.map((product) => product.id) } } }) : [];
  return { kit: sharedKitView(row, branchId, store.id, products, balances), store };
}

export async function listSharedKits(branchId: string, input: { storeId?: string | null; q?: string; page?: number; archived?: boolean }) {
  const businessGroupId = groupId(branchId);
  const store = await kitStore(branchId, input.storeId);
  const where = { businessGroupId, archived: input.archived ?? false, ...(input.q ? { name: { contains: input.q.slice(0, 200), mode: "insensitive" as const } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.sharedProductKit.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: Math.max(0, input.page ?? 0) * 30, take: 30 }),
    prisma.sharedProductKit.count({ where }),
  ]);
  const products = await productsFor(rows.flatMap((row) => readKitTemplateItems(row.items)), [branchId]);
  const balances = products.length ? await prisma.localStockBalance.findMany({ where: { branchId, storeId: store.id, productId: { in: products.map((product) => product.id) } } }) : [];
  return { kits: rows.map((row) => sharedKitView(row, branchId, store.id, products, balances)), total, store };
}

export async function sharedKitNetwork(context: BranchContext, input: { branchId?: string | null; q?: string; page?: number; archived?: boolean }) {
  const branches = context.branches.filter((branch) => branch.businessGroupId === context.businessGroupId);
  if (!branches.length || (input.branchId && !branches.some((branch) => branch.id === input.branchId))) throw new KitError("Нет доступа к выбранному филиалу", 403);
  return runWithBranchApiContext({ ...context, mode: "all", branchId: null, organizationId: null, branch: null, branches }, async () => {
    const businessGroupId = groupId();
    const branchIds = branches.map((branch) => branch.id);
    const where = { businessGroupId, archived: input.archived ?? false, ...(input.q ? { name: { contains: input.q.slice(0, 200), mode: "insensitive" as const } } : {}) };
    const [rows, total, stores] = await Promise.all([
      prisma.sharedProductKit.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: Math.max(0, input.page ?? 0) * 30, take: 30 }), prisma.sharedProductKit.count({ where }),
      prisma.localStore.findMany({ where: { branchId: { in: branchIds }, archived: false }, orderBy: [{ isMain: "desc" }, { name: "asc" }], select: { id: true, branchId: true, name: true } }),
    ]);
    const products = await productsFor(rows.flatMap((row) => readKitTemplateItems(row.items)), branchIds);
    const balances = products.length && stores.length ? await prisma.localStockBalance.findMany({ where: { branchId: { in: branchIds }, storeId: { in: stores.map((store) => store.id) }, productId: { in: products.map((product) => product.id) } } }) : [];
    const selectedBranchId = context.branchId || input.branchId || branchIds[0];
    const selectedBranch = branches.find((branch) => branch.id === selectedBranchId)!;
    const selectedStore = stores.find((store) => store.branchId === selectedBranchId);
    const kits = rows.map((row) => ({
      ...sharedKitView(row, selectedBranchId, selectedStore?.id || "", products, balances),
      branch: { id: selectedBranch.id, name: selectedBranch.displayName || selectedBranch.shortName || selectedBranch.name },
      storeName: selectedStore?.name || "Нет действующего склада",
      canManage: canManage(context),
      locations: branches.filter((branch) => !input.branchId || branch.id === input.branchId).flatMap((branch) => {
        const localStores = stores.filter((store) => store.branchId === branch.id);
        return (localStores.length ? localStores : [{ id: "", name: "Нет действующего склада", branchId: branch.id }]).map((store) => {
          const view = sharedKitView(row, branch.id, store.id, products, balances);
          return { branchId: branch.id, branchName: branch.displayName || branch.shortName || branch.name, storeId: store.id, storeName: store.name, ready: view.ready, status: view.status, mappingIssues: view.items.filter((item) => item.blocked).length };
        });
      }),
    }));
    return { kits, total, branches: branches.map((branch) => ({ id: branch.id, name: branch.displayName || branch.shortName || branch.name })), currentBranchId: context.branchId, currentStores: stores.filter((store) => store.branchId === context.branchId), canCreate: canManage(context) };
  });
}

export async function saveSharedKit(branchId: string, raw: unknown, id?: string) {
  const businessGroupId = writeGroupId(branchId);
  let input: ReturnType<typeof validateKitInput>;
  try { input = validateKitInput(raw); } catch (error) { throw new KitError(error instanceof Error ? error.message : "Неверный состав"); }
  const body = raw as { version?: unknown; items: Array<{ templateItemId?: unknown }> };
  const existing = id ? await findKit(id, businessGroupId) : null;
  if (existing && (!Number.isSafeInteger(body.version) || body.version !== existing.version || existing.archived)) throw new KitError("Комплект изменён или архивирован. Обновите список", 409);
  const prior = existing ? readKitTemplateItems(existing.items) : [];
  const localProducts = await prisma.localProduct.findMany({ where: { branchId, archived: false, entityType: { in: ["product", "variant"] }, id: { in: input.items.map((item) => item.productId) } }, select: productSelect });
  const items = input.items.map((line, index): KitTemplateItem => {
    const itemId = body.items[index]?.templateItemId;
    const old = typeof itemId === "string" ? prior.find((item) => item.id === itemId) : undefined;
    if (itemId && !old) throw new KitError("Позиция не принадлежит комплекту");
    const product = localProducts.find((candidate) => candidate.id === line.productId);
    if (old && line.productId === `unmapped:${old.id}`) return { ...old, quantity: line.quantity };
    if (!product) throw new KitError("Выберите действующий товар текущего филиала");
    if (old) {
      try { assertKitBinding(old.identity, product); } catch (error) { throw new KitError(error instanceof Error ? error.message : "Проверьте товар филиала"); }
      return { ...old, quantity: line.quantity, bindings: { ...old.bindings, [branchId]: product.id } };
    }
    return { id: randomUUID(), quantity: line.quantity, identity: kitProductIdentity(product), bindings: { [branchId]: product.id } };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new KitError("Позиции не должны повторяться");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shared-kits:${businessGroupId}`}))::text`;
    const others = await tx.sharedProductKit.findMany({ where: { businessGroupId, archived: false, ...(existing ? { id: { not: existing.id } } : {}) } });
    if (others.some((row) => sharedKitSignature(row.name, readKitTemplateItems(row.items)) === sharedKitSignature(input.name, items))) throw new KitError("Такой общий комплект уже существует. Найдите его в списке", 409);
    if (existing) {
      const updated = await tx.sharedProductKit.updateMany({ where: { id: existing.id, businessGroupId, version: existing.version, archived: false }, data: { name: input.name, items: json(items), version: { increment: 1 } } });
      if (!updated.count) throw new KitError("Комплект изменён. Обновите список", 409);
      return { id: existing.id };
    }
    return tx.sharedProductKit.create({ data: { businessGroupId, name: input.name, items: json(items) }, select: { id: true } });
  });
}

export async function updateSharedKit(branchId: string, id: string, body: Record<string, unknown>) {
  const businessGroupId = writeGroupId(branchId);
  if (!["target", "archive", "restore"].includes(String(body.action))) return saveSharedKit(branchId, body, id);
  const row = await findKit(id, businessGroupId);
  if (!Number.isSafeInteger(body.version) || body.version !== row.version) throw new KitError("Комплект изменён. Обновите список", 409);
  let data: Prisma.SharedProductKitUpdateManyMutationInput;
  if (body.action === "target") {
    if (row.archived || typeof body.storeId !== "string" || typeof body.quantity !== "number" || !Number.isSafeInteger(body.quantity) || body.quantity < 0 || body.quantity > 1_000_000) throw new KitError("Укажите действующий склад и целевой запас от 0 до 1 000 000");
    const store = await kitStore(branchId, body.storeId);
    const targets = row.targets && typeof row.targets === "object" && !Array.isArray(row.targets) ? row.targets : {};
    data = { targets: json({ ...targets, [store.id]: body.quantity }), version: { increment: 1 } };
  } else data = { archived: body.action === "archive", version: { increment: 1 } };
  const updated = await prisma.sharedProductKit.updateMany({ where: { businessGroupId, id: row.id, version: row.version }, data });
  if (!updated.count) throw new KitError("Комплект изменён. Обновите список", 409);
  return { ok: true };
}
