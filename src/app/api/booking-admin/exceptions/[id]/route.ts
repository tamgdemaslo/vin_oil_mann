import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { BookingError, bookingErrorPayload } from "@/lib/booking/errors";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: Context) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права изменять исключения расписания");
    const { id } = await context.params;
    const result = await runWithBranchApiContext(access.context, () => prisma.bookingScheduleException.deleteMany({
      where: { id, branchId: access.context.branchId! },
    }));
    if (!result.count) throw new BookingError("Исключение не найдено", "booking_exception_not_found", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
