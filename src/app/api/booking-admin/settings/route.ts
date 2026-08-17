import { Prisma, type PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { isCatalogBookingServiceId } from "@/lib/booking/catalog-services";
import { bookingErrorPayload, BookingError } from "@/lib/booking/errors";
import { assertLocalTime } from "@/lib/booking/timezone";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, index) => ({
  weekday: index + 1,
  isWorking: index < 6,
  startTime: index < 6 ? "09:00" : null,
  endTime: index < 6 ? "19:00" : null,
}));

function bounded(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function workingHours(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_HOURS;
  const rows = value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const weekday = bounded(row.weekday, 0, 1, 7);
    const isWorking = row.isWorking === true;
    const startTime = isWorking && typeof row.startTime === "string" ? assertLocalTime(row.startTime) : null;
    const endTime = isWorking && typeof row.endTime === "string" ? assertLocalTime(row.endTime) : null;
    if (isWorking && (!startTime || !endTime || startTime >= endTime)) {
      throw new BookingError("Проверьте часы работы филиала", "booking_working_hours_invalid");
    }
    return { weekday, isWorking, startTime, endTime };
  });
  if (new Set(rows.map((row) => row.weekday)).size !== 7) {
    throw new BookingError("Нужно настроить все семь дней недели", "booking_working_hours_invalid");
  }
  return rows.sort((left, right) => left.weekday - right.weekday);
}

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права просматривать настройки записи");
    const branchId = access.context.branchId!;
    const state = await runWithBranchApiContext(access.context, async () => {
      const [settings, branchHours, services, memberships, exceptions] = await Promise.all([
        prisma.branchBookingSettings.findUnique({ where: { branchId } }),
        prisma.branchBookingWorkingHour.findMany({ where: { branchId }, orderBy: { weekday: "asc" } }),
        prisma.bookingService.findMany({ where: { branchId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
        prisma.branchMembership.findMany({
          where: { branchId, status: "active", user: { status: "active" } },
          include: {
            user: { select: { id: true, name: true, login: true } },
            bookingServices: { select: { serviceId: true } },
            bookingHours: { orderBy: { weekday: "asc" } },
          },
          orderBy: [{ position: "asc" }, { user: { name: "asc" } }],
        }),
        prisma.bookingScheduleException.findMany({
          where: { branchId },
          orderBy: [{ localDate: "asc" }, { membershipId: "asc" }],
          take: 1_000,
        }),
      ]);
      return { settings, branchHours, services, memberships, exceptions };
    });
    return NextResponse.json({
      branch: access.context.branch,
      canManage: canManageBookingSettings(access.context),
      settings: state.settings ?? {
        publicBookingEnabled: false,
        publicName: access.context.branch?.shortName ?? access.context.branch?.name ?? "",
        publicIntro: "",
        bookingStepMinutes: 30,
        bookingHorizonDays: 60,
        minimumLeadMinutes: 60,
      },
      workingHours: state.branchHours.length ? state.branchHours : DEFAULT_HOURS,
      services: state.services.map((service) => ({
        ...service,
        catalogManaged: isCatalogBookingServiceId(service.id),
      })),
      masters: state.memberships.map((membership) => ({
        membershipId: membership.id,
        userId: membership.userId,
        name: membership.user.name,
        login: membership.user.login,
        roleId: membership.roleId,
        position: membership.position,
        serviceIds: membership.bookingServices.map((item) => item.serviceId),
        workingHours: membership.bookingHours,
      })),
      exceptions: state.exceptions,
    });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права изменять настройки записи");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new BookingError("Неверное тело запроса", "booking_settings_invalid");
    const hours = workingHours(body.workingHours);
    const branchId = access.context.branchId!;
    const publicName = typeof body.publicName === "string" ? body.publicName.trim().slice(0, 160) || null : null;
    const publicIntro = typeof body.publicIntro === "string" ? body.publicIntro.trim().slice(0, 2_000) || null : null;
    await runWithBranchApiContext(access.context, () => (prisma as unknown as PrismaClient).$transaction(async (tx) => {
      await tx.branchBookingSettings.upsert({
        where: { branchId },
        create: {
          branchId,
          publicBookingEnabled: body.publicBookingEnabled === true,
          publicName,
          publicIntro,
          bookingStepMinutes: bounded(body.bookingStepMinutes, 30, 5, 240),
          bookingHorizonDays: bounded(body.bookingHorizonDays, 60, 1, 365),
          minimumLeadMinutes: bounded(body.minimumLeadMinutes, 60, 0, 10_080),
        },
        update: {
          publicBookingEnabled: body.publicBookingEnabled === true,
          publicName,
          publicIntro,
          bookingStepMinutes: bounded(body.bookingStepMinutes, 30, 5, 240),
          bookingHorizonDays: bounded(body.bookingHorizonDays, 60, 1, 365),
          minimumLeadMinutes: bounded(body.minimumLeadMinutes, 60, 0, 10_080),
        },
      });
      await tx.branchBookingWorkingHour.deleteMany({ where: { branchId } });
      await tx.branchBookingWorkingHour.createMany({ data: hours.map((row) => ({ branchId, ...row })) });
      await tx.branchAuditLog.create({
        data: {
          businessGroupId: access.context.businessGroupId,
          branchId,
          userId: access.context.userId,
          action: "booking.settings.updated",
          entityType: "branch_booking_settings",
          entityId: branchId,
          metadata: { publicBookingEnabled: body.publicBookingEnabled === true },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
