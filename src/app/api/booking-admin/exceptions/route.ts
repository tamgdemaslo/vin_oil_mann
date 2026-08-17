import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { BOOKING_MASTER_ROLE_ID } from "@/lib/booking/constants";
import { BookingError, bookingErrorPayload } from "@/lib/booking/errors";
import { assertLocalDate, assertLocalTime } from "@/lib/booking/timezone";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права изменять исключения расписания");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const membershipId = typeof body?.membershipId === "string" ? body.membershipId : "";
    const localDate = assertLocalDate(typeof body?.localDate === "string" ? body.localDate : "");
    const kind = body?.kind === "CUSTOM" ? "CUSTOM" : "CLOSED";
    const startTime = kind === "CUSTOM" && typeof body?.startTime === "string" ? assertLocalTime(body.startTime) : null;
    const endTime = kind === "CUSTOM" && typeof body?.endTime === "string" ? assertLocalTime(body.endTime) : null;
    if (!membershipId || (kind === "CUSTOM" && (!startTime || !endTime || startTime >= endTime))) {
      throw new BookingError("Проверьте исключение расписания", "booking_exception_invalid");
    }
    const branchId = access.context.branchId!;
    const membership = await runWithBranchApiContext(access.context, () => prisma.branchMembership.findFirst({
      where: {
        id: membershipId,
        branchId,
        roleId: BOOKING_MASTER_ROLE_ID,
        status: "active",
        user: { status: "active" },
      },
    }));
    if (!membership) throw new BookingError("Сотрудник не найден", "booking_master_not_found", 404);
    const exception = await runWithBranchApiContext(access.context, () => prisma.bookingScheduleException.upsert({
      where: { membershipId_localDate: { membershipId, localDate } },
      create: { branchId, membershipId, localDate, kind, startTime, endTime, note: typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null },
      update: { kind, startTime, endTime, note: typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null },
    }));
    return NextResponse.json({ exception });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
