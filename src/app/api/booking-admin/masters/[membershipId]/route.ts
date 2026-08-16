import { Prisma, type PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { BookingError, bookingErrorPayload } from "@/lib/booking/errors";
import { assertLocalTime } from "@/lib/booking/timezone";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ membershipId: string }> };

function hoursInput(value: unknown) {
  if (!Array.isArray(value)) throw new BookingError("Расписание мастера не указано", "booking_master_hours_invalid");
  const rows = value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const weekday = Math.trunc(Number(row.weekday));
    const isWorking = row.isWorking === true;
    const startTime = isWorking && typeof row.startTime === "string" ? assertLocalTime(row.startTime) : null;
    const endTime = isWorking && typeof row.endTime === "string" ? assertLocalTime(row.endTime) : null;
    if (weekday < 1 || weekday > 7 || (isWorking && (!startTime || !endTime || startTime >= endTime))) {
      throw new BookingError("Проверьте расписание мастера", "booking_master_hours_invalid");
    }
    return { weekday, isWorking, startTime, endTime };
  });
  if (new Set(rows.map((row) => row.weekday)).size !== 7) throw new BookingError("Нужно настроить семь дней", "booking_master_hours_invalid");
  return rows;
}

export async function PUT(request: NextRequest, context: Context) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права изменять расписания мастеров");
    const { membershipId } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new BookingError("Неверное тело запроса", "booking_master_invalid");
    const branchId = access.context.branchId!;
    const serviceIds = [...new Set(Array.isArray(body.serviceIds) ? body.serviceIds.map(String).filter(Boolean) : [])];
    const hours = hoursInput(body.workingHours);
    await runWithBranchApiContext(access.context, () => (prisma as unknown as PrismaClient).$transaction(async (tx) => {
      const membership = await tx.branchMembership.findFirst({ where: { id: membershipId, branchId, status: "active" } });
      if (!membership) throw new BookingError("Сотрудник не найден", "booking_master_not_found", 404);
      const serviceCount = serviceIds.length ? await tx.bookingService.count({ where: { branchId, id: { in: serviceIds }, status: "ACTIVE" } }) : 0;
      if (serviceCount !== serviceIds.length) throw new BookingError("Одна из услуг недоступна", "booking_service_unavailable", 409);
      await tx.bookingMasterService.deleteMany({ where: { branchId, membershipId } });
      if (serviceIds.length) await tx.bookingMasterService.createMany({ data: serviceIds.map((serviceId) => ({ branchId, membershipId, serviceId })) });
      await tx.bookingMasterWorkingHour.deleteMany({ where: { branchId, membershipId } });
      await tx.bookingMasterWorkingHour.createMany({ data: hours.map((row) => ({ branchId, membershipId, ...row })) });
      await tx.branchAuditLog.create({ data: {
        businessGroupId: access.context.businessGroupId,
        branchId,
        userId: access.context.userId,
        action: "booking.master_schedule.updated",
        entityType: "branch_membership",
        entityId: membershipId,
        metadata: { serviceIds },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
