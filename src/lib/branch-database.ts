import { prisma } from "@/lib/db";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";

export class BranchRelationViolation extends Error {
  constructor(public readonly entityType: string) {
    super(`Связанная сущность ${entityType} не принадлежит активному филиалу`);
    this.name = "BranchRelationViolation";
  }
}

async function requireEntity(
  branchId: string,
  entityType: "client" | "product" | "store" | "shipment" | "conversation",
  id: string
) {
  const found = entityType === "client"
    ? await prisma.localCounterparty.findFirst({ where: { branchId, id }, select: { id: true } })
    : entityType === "product"
      ? await prisma.localProduct.findFirst({ where: { branchId, id }, select: { id: true } })
      : entityType === "store"
        ? await prisma.localStore.findFirst({ where: { branchId, id }, select: { id: true } })
        : entityType === "shipment"
          ? await prisma.localDemand.findFirst({ where: { branchId, id }, select: { id: true } })
          : await prisma.messengerConversation.findFirst({ where: { branchId, id }, select: { id: true } });
  if (!found) throw new BranchRelationViolation(entityType);
  return found.id;
}

export function getBranchDatabaseContext() {
  const branchId = getScopedBranchId();
  return {
    branchId,
    clients: {
      findById: (id: string) => prisma.localCounterparty.findFirst({ where: { branchId, id } }),
      search: (term: string, take = 50) => prisma.localCounterparty.findMany({
        where: { branchId, OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }] },
        take: Math.min(100, Math.max(1, take)),
      }),
    },
    products: {
      findById: (id: string) => prisma.localProduct.findFirst({ where: { branchId, id } }),
      search: (term: string, take = 50) => prisma.localProduct.findMany({
        where: { branchId, archived: false, OR: [{ name: { contains: term, mode: "insensitive" } }, { article: { contains: term, mode: "insensitive" } }] },
        take: Math.min(100, Math.max(1, take)),
      }),
    },
    shipments: {
      findById: (id: string) => prisma.localDemand.findFirst({ where: { branchId, id } }),
      assertRelations: async (input: { clientId?: string | null; storeId?: string | null; productIds?: string[] }) => {
        if (input.clientId) await requireEntity(branchId, "client", input.clientId);
        if (input.storeId) await requireEntity(branchId, "store", input.storeId);
        for (const productId of new Set(input.productIds ?? [])) await requireEntity(branchId, "product", productId);
      },
    },
    messenger: {
      findConversationById: (id: string) => prisma.messengerConversation.findFirst({ where: { branchId, id } }),
      assertConversation: (id: string) => requireEntity(branchId, "conversation", id),
    },
  };
}

export function getGroupAnalyticsDatabase() {
  const tenant = getRequestTenant();
  if (!tenant || tenant.mode !== "all" || tenant.allowedBranchIds.length === 0) {
    throw new Error("Режим аналитики всех филиалов не разрешён");
  }
  const branchIds = [...tenant.allowedBranchIds];
  return {
    branchIds,
    countClients: () => prisma.localCounterparty.count({ where: { branchId: { in: branchIds } } }),
    countShipments: () => prisma.localDemand.count({ where: { branchId: { in: branchIds } } }),
    countProducts: () => prisma.localProduct.count({ where: { branchId: { in: branchIds } } }),
  };
}
