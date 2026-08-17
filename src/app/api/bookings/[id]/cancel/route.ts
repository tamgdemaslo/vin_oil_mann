import { NextRequest, NextResponse } from "next/server";
import { canManageBookings, requireBookingCapability } from "@/lib/booking/access";
import { bookingDto } from "@/lib/booking/dto";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { buildBookingManagementUrl } from "@/lib/booking/management-url";
import { notifyBookingCancelled } from "@/lib/booking/notifications";
import { bookingManagementToken, cancelBooking } from "@/lib/booking/service";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookings(access.context), "Нет права отменять записи");
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { reason?: unknown } | null;
    const booking = await runWithBranchApiContext(access.context, () => cancelBooking(
      id,
      typeof body?.reason === "string" ? body.reason : null,
      { kind: "USER", userId: access.context.userId },
    ));
    const token = bookingManagementToken(booking);
    const managementUrl = buildBookingManagementUrl(request, token);
    await runWithBranchApiContext(access.context, () => notifyBookingCancelled(booking, managementUrl))
      .catch((error) => console.warn("[booking/admin-cancelled-notification]", error));
    return NextResponse.json({ booking: bookingDto(booking) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
