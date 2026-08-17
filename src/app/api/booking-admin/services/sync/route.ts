import { Prisma, type PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { syncCatalogBookingServices } from "@/lib/booking/catalog-services";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

export async function POST() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права синхронизировать услуги");
    const branchId = access.context.branchId!;
    const result = await runWithBranchApiContext(access.context, () => (prisma as unknown as PrismaClient).$transaction(async (tx) => {
      const syncResult = await syncCatalogBookingServices(tx, branchId);
      if (syncResult.added || syncResult.updated || syncResult.disabled) {
        await tx.branchAuditLog.create({ data: {
          businessGroupId: access.context.businessGroupId,
          branchId,
          userId: access.context.userId,
          action: "booking.services.catalog_synced",
          entityType: "booking_service",
          entityId: branchId,
          metadata: syncResult,
        } });
      }
      return syncResult;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return NextResponse.json({ result });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
