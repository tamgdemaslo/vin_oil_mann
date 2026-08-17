import type { Prisma } from "@prisma/client";

export const CATALOG_BOOKING_SERVICE_PREFIX = "catalog-service:";

type CatalogBookingDb = Pick<Prisma.TransactionClient, "bookingService" | "localProduct">;

type CatalogServiceProduct = {
  id: string;
  name: string;
  description: string | null;
};

type ManagedBookingService = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

export type CatalogBookingSyncResult = {
  catalogCount: number;
  added: number;
  updated: number;
  disabled: number;
};

export function catalogBookingServiceId(productId: string) {
  return `${CATALOG_BOOKING_SERVICE_PREFIX}${productId}`;
}

export function isCatalogBookingServiceId(serviceId: string) {
  return serviceId.startsWith(CATALOG_BOOKING_SERVICE_PREFIX);
}

/**
 * Mirrors active catalog service cards into the booking directory.
 *
 * Booking-specific settings (duration, online visibility, required fields and
 * master assignments) intentionally stay on BookingService. Only catalog-owned
 * identity fields are refreshed here. A deterministic id makes the operation
 * safe to repeat without adding duplicates or requiring a schema migration.
 */
export async function syncCatalogBookingServices(
  db: CatalogBookingDb,
  branchId: string,
): Promise<CatalogBookingSyncResult> {
  const products = await db.localProduct.findMany({
    where: { branchId, entityType: "service", archived: false },
    select: { id: true, name: true, description: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  }) as CatalogServiceProduct[];

  const managed = await db.bookingService.findMany({
    where: { branchId, id: { startsWith: CATALOG_BOOKING_SERVICE_PREFIX } },
    select: { id: true, name: true, description: true, status: true },
  }) as ManagedBookingService[];

  const existingById = new Map(managed.map((service) => [service.id, service]));
  const activeIds = new Set(products.map((product) => catalogBookingServiceId(product.id)));
  const missing = products.filter((product) => !existingById.has(catalogBookingServiceId(product.id)));
  const changed = products.filter((product) => {
    const current = existingById.get(catalogBookingServiceId(product.id));
    return current && (
      current.name !== product.name ||
      current.description !== product.description ||
      current.status !== "ACTIVE"
    );
  });
  const staleIds = managed.filter((service) => !activeIds.has(service.id) && service.status !== "INACTIVE").map((service) => service.id);

  if (missing.length) {
    await db.bookingService.createMany({
      data: missing.map((product, index) => ({
        id: catalogBookingServiceId(product.id),
        branchId,
        name: product.name,
        description: product.description,
        durationMinutes: 60,
        onlineBookingEnabled: false,
        requiresVin: false,
        requiresConfirmation: false,
        requiredFieldsJson: [],
        sortOrder: index,
        status: "ACTIVE",
      })),
      skipDuplicates: true,
    });
  }

  await Promise.all(changed.map((product) => db.bookingService.updateMany({
    where: { branchId, id: catalogBookingServiceId(product.id) },
    data: { name: product.name, description: product.description, status: "ACTIVE" },
  })));

  if (staleIds.length) {
    await db.bookingService.updateMany({
      where: { branchId, id: { in: staleIds } },
      data: { status: "INACTIVE", onlineBookingEnabled: false },
    });
  }

  return {
    catalogCount: products.length,
    added: missing.length,
    updated: changed.length,
    disabled: staleIds.length,
  };
}
