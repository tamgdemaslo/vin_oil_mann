import { NextRequest, NextResponse } from "next/server";
import { canConfirmBookings, requireBookingCapability } from "@/lib/booking/access";
import { bookingDto } from "@/lib/booking/dto";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { buildBookingManagementUrl } from "@/lib/booking/management-url";
import { notifyBookingConfirmed } from "@/lib/booking/notifications";
import { bookingManagementToken, confirmBooking } from "@/lib/booking/service";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canConfirmBookings(access.context), "Нет права подтверждать записи");
    const { id } = await context.params;
    const booking = await runWithBranchApiContext(access.context, () => confirmBooking(id, {
      kind: "USER",
      userId: access.context.userId,
    }));
    const token = bookingManagementToken(booking);
    const managementUrl = buildBookingManagementUrl(request, token);
    await runWithBranchApiContext(access.context, () => notifyBookingConfirmed(booking, managementUrl))
      .catch((error) => console.warn("[booking/confirmed-notification]", error));
    return NextResponse.json({ booking: bookingDto(booking) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
