import { NextRequest, NextResponse } from "next/server";
import { bookingViewIsSelfOnly, canViewBookings, requireBookingCapability } from "@/lib/booking/access";
import { getBookingAvailability } from "@/lib/booking/availability";
import { BOOKING_MASTER_ROLE_ID } from "@/lib/booking/constants";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { addLocalDays, localTimeToMinutes, zonedLocalToUtc } from "@/lib/booking/timezone";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canViewBookings(access.context));
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const requestedBranchId = typeof body?.branchId === "string" ? body.branchId : access.context.branchId;
    if (!requestedBranchId || !readableBranchIds(access.context).includes(requestedBranchId)) {
      return NextResponse.json({ error: "Филиал недоступен" }, { status: 403 });
    }
    const ownMembership = bookingViewIsSelfOnly(access.context)
      ? await runWithBranchApiContext(access.context, () => prisma.branchMembership.findFirst({
          where: {
            branchId: requestedBranchId,
            userId: access.context.userId,
            roleId: BOOKING_MASTER_ROLE_ID,
            status: "active",
          },
          select: { id: true },
        }))
      : null;
    const localDate = typeof body?.localDate === "string" ? body.localDate : "";
    const serviceIds = Array.isArray(body?.serviceIds) ? body.serviceIds.map(String) : [];
    const masterMembershipId = bookingViewIsSelfOnly(access.context)
      ? ownMembership?.id ?? "__none__"
      : typeof body?.masterMembershipId === "string" ? body.masterMembershipId : null;
    const excludeBookingId = typeof body?.excludeBookingId === "string" ? body.excludeBookingId : null;
    const durationOverrideMinutes = typeof body?.durationOverrideMinutes === "number"
      ? body.durationOverrideMinutes
      : null;
    const requestedLocalTime = typeof body?.requestedLocalTime === "string" ? body.requestedLocalTime : "";
    const baseInput = {
      branchId: requestedBranchId,
      serviceIds,
      masterMembershipId,
      onlineOnly: false,
      respectLeadTime: false,
      excludeBookingId,
      durationOverrideMinutes,
    };
    const result = await runWithBranchApiContext(access.context, () => getBookingAvailability({ ...baseInput, localDate }));
    if (!requestedLocalTime) return NextResponse.json(result);

    const exact = result.slots.find((slot) => slot.localTime === requestedLocalTime && (!masterMembershipId || slot.master.membershipId === masterMembershipId));
    let reasonCode = result.reasonCode;
    let message = result.message;
    if (!exact && !reasonCode) {
      const requestedStart = zonedLocalToUtc(localDate, requestedLocalTime, result.branch.timezone);
      const requestedEnd = new Date(requestedStart.getTime() + result.durationMinutes * 60_000);
      const overlaps = await runWithBranchApiContext(access.context, () => prisma.booking.count({
        where: {
          branchId: requestedBranchId,
          masterMembershipId: masterMembershipId ?? undefined,
          status: "ACTIVE",
          startsAt: { lt: requestedEnd },
          endsAt: { gt: requestedStart },
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        },
      }));
      if (overlaps > 0) {
        reasonCode = "slot_taken";
        message = "На выбранное время уже есть запись";
      } else if (localTimeToMinutes(requestedLocalTime) % result.stepMinutes !== 0) {
        reasonCode = "nonstandard_start";
        message = `Начало записи выбирается с шагом ${result.stepMinutes} минут`;
      } else {
        reasonCode = "outside_schedule";
        const window = result.workingWindows.find((item) => !masterMembershipId || item.membershipId === masterMembershipId);
        const requestedEndMinute = localTimeToMinutes(requestedLocalTime) + result.durationMinutes;
        message = window && requestedEndMinute > localTimeToMinutes(window.endTime)
          ? `Мастер принимает до ${window.endTime}, работа закончится в ${String(Math.floor(requestedEndMinute / 60)).padStart(2, "0")}:${String(requestedEndMinute % 60).padStart(2, "0")}`
          : `Мастер не успеет выполнить работы за ${result.durationMinutes} минут в пределах своего графика`;
      }
    }

    const alternatives = result.slots.filter((slot) => slot.startsAt !== exact?.startsAt).slice(0, 3);
    for (let offset = 1; alternatives.length < 3 && offset <= 14; offset += 1) {
      const alternativeDate = addLocalDays(localDate, offset);
      try {
        const next = await runWithBranchApiContext(access.context, () => getBookingAvailability({ ...baseInput, localDate: alternativeDate }));
        alternatives.push(...next.slots.slice(0, 3 - alternatives.length));
      } catch {
        break;
      }
    }
    return NextResponse.json({
      ...result,
      available: Boolean(exact),
      reasonCode: exact ? null : reasonCode ?? "slot_unavailable",
      message: exact ? "Время подтверждено" : message ?? "Выбранное время недоступно",
      alternatives,
    });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
