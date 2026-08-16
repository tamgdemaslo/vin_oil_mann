import { NextRequest, NextResponse } from "next/server";
import { bookingViewIsSelfOnly, canViewBookings, requireBookingCapability } from "@/lib/booking/access";
import { getBookingAvailability } from "@/lib/booking/availability";
import { bookingErrorPayload } from "@/lib/booking/errors";
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
          where: { branchId: requestedBranchId, userId: access.context.userId, status: "active" },
          select: { id: true },
        }))
      : null;
    const result = await runWithBranchApiContext(access.context, () => getBookingAvailability({
      branchId: requestedBranchId,
      localDate: typeof body?.localDate === "string" ? body.localDate : "",
      serviceIds: Array.isArray(body?.serviceIds) ? body.serviceIds.map(String) : [],
      masterMembershipId: bookingViewIsSelfOnly(access.context)
        ? ownMembership?.id ?? "__none__"
        : typeof body?.masterMembershipId === "string" ? body.masterMembershipId : null,
      onlineOnly: false,
      respectLeadTime: false,
      excludeBookingId: typeof body?.excludeBookingId === "string" ? body.excludeBookingId : null,
    }));
    return NextResponse.json(result);
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
