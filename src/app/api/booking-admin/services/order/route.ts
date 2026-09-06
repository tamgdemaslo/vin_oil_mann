import { Prisma, type PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { BookingError, bookingErrorPayload } from "@/lib/booking/errors";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

export async function PUT(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права изменять порядок услуг");
    const body = await request.json().catch(() => null) as { serviceIds?: unknown } | null;
    const serviceIds = Array.isArray(body?.serviceIds)
      ? body.serviceIds.map(String).map((id) => id.trim()).filter(Boolean)
      : [];
    if (!serviceIds.length || serviceIds.length > 1_000 || new Set(serviceIds).size !== serviceIds.length) {
      throw new BookingError("Некорректный порядок услуг", "booking_service_order_invalid");
    }

    const branchId = access.context.branchId!;
    await runWithBranchApiContext(access.context, () => (prisma as unknown as PrismaClient).$transaction(async (tx) => {
      const current = await tx.bookingService.findMany({ where: { branchId }, select: { id: true } });
      const currentIds = new Set(current.map((service) => service.id));
      if (current.length !== serviceIds.length || serviceIds.some((id) => !currentIds.has(id))) {
        throw new BookingError("Список услуг изменился. Обновите страницу и повторите сортировку", "booking_service_order_stale", 409);
      }
      await Promise.all(serviceIds.map((id, sortOrder) => tx.bookingService.update({
        where: { branchId_id: { branchId, id } },
        data: { sortOrder },
      })));
      await tx.branchAuditLog.create({ data: {
        businessGroupId: access.context.businessGroupId,
        branchId,
        userId: access.context.userId,
        action: "booking.services.reordered",
        entityType: "booking_service",
        entityId: branchId,
        metadata: { serviceIds },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
