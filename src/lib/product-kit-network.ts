import { prisma } from "@/lib/db";
import type { BranchContext } from "@/lib/branch-context";
import { runWithBranchApiContext } from "@/lib/branch-api";
import { KitError, kitViews } from "@/lib/product-kits";

/** Shared read-only catalog. The branch list comes from verified membership, never the client. */
export async function listNetworkKits(context: BranchContext, input: { branchId?: string | null; q?: string; page?: number; archived?: boolean }) {
  const branches = context.branches.filter((branch) => branch.businessGroupId === context.businessGroupId);
  if (input.branchId && !branches.some((branch) => branch.id === input.branchId)) throw new KitError("Нет доступа к выбранному филиалу", 403);
  const branchIds = branches.filter((branch) => !input.branchId || branch.id === input.branchId).map((branch) => branch.id);
  if (!branchIds.length) throw new KitError("Нет доступных филиалов", 403);
  // This scope permits reads only. POST/PATCH and shipment expansion keep their concrete branch guards.
  return runWithBranchApiContext({ ...context, mode: "all", branchId: null, organizationId: null, branch: null, branches }, async () => {
    const where = { branchId: { in: branchIds }, archived: input.archived ?? false, ...(input.q ? { name: { contains: input.q.slice(0, 200), mode: "insensitive" as const } } : {}) };
    const page = Math.max(0, Math.min(100_000, Math.floor(input.page ?? 0)));
    const [records, total, stores] = await Promise.all([
      prisma.productKit.findMany({ where, include: { items: { orderBy: { position: "asc" }, include: { product: true } }, targets: true }, orderBy: [{ name: "asc" }, { branchId: "asc" }, { id: "asc" }], skip: page * 30, take: 30 }),
      prisma.productKit.count({ where }),
      prisma.localStore.findMany({ where: { branchId: { in: branches.map((branch) => branch.id) }, archived: false }, orderBy: [{ isMain: "desc" }, { name: "asc" }], select: { id: true, branchId: true, name: true } }),
    ]);
    const productIds = [...new Set(records.flatMap((kit) => kit.items.map((item) => item.productId)))];
    const balances = productIds.length && stores.length ? await prisma.localStockBalance.findMany({ where: { branchId: { in: branchIds }, storeId: { in: stores.map((store) => store.id) }, productId: { in: productIds } } }) : [];
    const kits = await Promise.all(records.map(async (record) => {
      const branch = branches.find((candidate) => candidate.id === record.branchId)!;
      const branchStores = stores.filter((store) => store.branchId === record.branchId);
      const views = await Promise.all((branchStores.length ? branchStores : [{ id: "", name: "Нет действующего склада", branchId: record.branchId }]).map(async (store) => ({
        store,
        kit: (await kitViews(record.branchId, store.id, [record], balances.filter((balance) => balance.branchId === record.branchId && balance.storeId === store.id)))[0],
      })));
      return {
        ...views[0].kit,
        branch: { id: branch.id, name: branch.displayName || branch.shortName || branch.name },
        storeName: views[0].store.name,
        canManage: context.mode === "branch" && record.branchId === context.branchId && branch.status === "active",
        locations: branchStores.length ? views.map(({ store, kit }) => ({ storeId: store.id, storeName: store.name, ready: kit.ready, status: kit.status })) : [],
      };
    }));
    return { kits, total, branches: branches.map((branch) => ({ id: branch.id, name: branch.displayName || branch.shortName || branch.name })), currentBranchId: context.branchId, currentStores: stores.filter((store) => store.branchId === context.branchId), canCreate: context.mode === "branch" && context.branch?.status === "active" };
  });
}

export type ProductKitNetworkResponse = Awaited<ReturnType<typeof listNetworkKits>>;
export type ProductKitNetworkView = ProductKitNetworkResponse["kits"][number];
