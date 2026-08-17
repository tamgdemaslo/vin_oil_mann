import { NextRequest, NextResponse } from "next/server";
import { canManageBookings, canOverrideBookingConflict, requireBookingCapability } from "@/lib/booking/access";
import { bookingDto } from "@/lib/booking/dto";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { buildBookingManagementUrl } from "@/lib/booking/management-url";
import { notifyBookingRescheduled } from "@/lib/booking/notifications";
import { bookingManagementToken, rescheduleBooking } from "@/lib/booking/service";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookings(access.context), "Нет права переносить записи");
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const booking = await runWithBranchApiContext(access.context, () => rescheduleBooking(id, {
      startsAt: typeof body?.startsAt === "string" ? body.startsAt : "",
      masterMembershipId: typeof body?.masterMembershipId === "string" ? body.masterMembershipId : null,
      serviceIds: Array.isArray(body?.serviceIds) ? body.serviceIds.map(String) : null,
      overrideConflict: body?.overrideConflict === true,
    }, {
      kind: "USER",
      userId: access.context.userId,
      allowConflictOverride: canOverrideBookingConflict(access.context),
      respectLeadTime: false,
    }));
    const token = bookingManagementToken(booking);
    const managementUrl = buildBookingManagementUrl(request, token);
    await runWithBranchApiContext(access.context, () => notifyBookingRescheduled(booking, managementUrl))
      .catch((error) => console.warn("[booking/admin-rescheduled-notification]", error));
    return NextResponse.json({ booking: bookingDto(booking), managementUrl });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
