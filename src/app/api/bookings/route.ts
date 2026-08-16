import { NextRequest, NextResponse } from "next/server";
import { bookingDto } from "@/lib/booking/dto";
import { bookingViewIsSelfOnly, canManageBookings, canViewBookings, canOverrideBookingConflict, requireBookingCapability } from "@/lib/booking/access";
import { bookingErrorPayload, BookingError } from "@/lib/booking/errors";
import { notifyBookingCreated } from "@/lib/booking/notifications";
import { BOOKING_INCLUDE, createBooking, type CreateBookingInput } from "@/lib/booking/service";
import { addLocalDays, localDateUtcRange } from "@/lib/booking/timezone";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

function parsedDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canViewBookings(access.context));
    const branchIds = readableBranchIds(access.context);
    const now = new Date();
    const from = parsedDate(request.nextUrl.searchParams.get("from"), new Date(now.getTime() - 24 * 60 * 60_000));
    const to = parsedDate(request.nextUrl.searchParams.get("to"), new Date(now.getTime() + 31 * 24 * 60 * 60_000));
    const masterMembershipId = request.nextUrl.searchParams.get("masterMembershipId")?.trim() || null;
    const requestedBranchId = request.nextUrl.searchParams.get("branchId")?.trim() || null;
    if (requestedBranchId && !branchIds.includes(requestedBranchId)) {
      throw new BookingError("Филиал недоступен", "booking_branch_access_denied", 403);
    }
    const scopedIds = requestedBranchId && branchIds.includes(requestedBranchId) ? [requestedBranchId] : branchIds;
    const localFrom = request.nextUrl.searchParams.get("localFrom")?.trim() || null;
    const localTo = request.nextUrl.searchParams.get("localTo")?.trim() || null;
    const branchDateRanges = localFrom && localTo && /^\d{4}-\d{2}-\d{2}$/.test(localFrom) && /^\d{4}-\d{2}-\d{2}$/.test(localTo)
      ? await runWithBranchApiContext(access.context, async () => {
          const branches = await prisma.branch.findMany({ where: { id: { in: scopedIds } }, select: { id: true, timezone: true } });
          return branches.map((branch) => ({
            branchId: branch.id,
            startsAt: { lt: localDateUtcRange(addLocalDays(localTo, 1), branch.timezone).start },
            endsAt: { gt: localDateUtcRange(localFrom, branch.timezone).start },
          }));
        })
      : null;
    const ownMembership = bookingViewIsSelfOnly(access.context) && access.context.branchId
      ? await runWithBranchApiContext(access.context, () => prisma.branchMembership.findFirst({
          where: { branchId: access.context.branchId!, userId: access.context.userId, status: "active" },
          select: { id: true },
        }))
      : null;
    const visibleMasterMembershipId = bookingViewIsSelfOnly(access.context) ? ownMembership?.id ?? "__none__" : masterMembershipId;
    const bookings = await runWithBranchApiContext(access.context, () => prisma.booking.findMany({
      where: {
        branchId: { in: scopedIds },
        ...(branchDateRanges ? { OR: branchDateRanges } : { startsAt: { lt: to }, endsAt: { gt: from } }),
        ...(visibleMasterMembershipId ? { masterMembershipId: visibleMasterMembershipId } : {}),
      },
      include: BOOKING_INCLUDE,
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      take: 2_000,
    }));
    return NextResponse.json({ bookings: bookings.map(bookingDto), total: bookings.length });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookings(access.context), "Нет права создавать записи");
    const body = await request.json().catch(() => null) as (CreateBookingInput & Record<string, unknown>) | null;
    if (!body) return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
    const result = await runWithBranchApiContext(access.context, () => createBooking({
      branchId: access.context.branchId!,
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds.map(String) : [],
      masterMembershipId: String(body.masterMembershipId ?? ""),
      startsAt: String(body.startsAt ?? ""),
      customerName: String(body.customerName ?? ""),
      phone: String(body.phone ?? ""),
      email: typeof body.email === "string" ? body.email : null,
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      vehicleId: typeof body.vehicleId === "string" ? body.vehicleId : null,
      vehicle: body.vehicle && typeof body.vehicle === "object" ? body.vehicle : null,
      comment: typeof body.comment === "string" ? body.comment : null,
      internalComment: typeof body.internalComment === "string" ? body.internalComment : null,
      source: "ADMIN",
      overrideConflict: body.overrideConflict === true,
    }, {
      kind: "USER",
      userId: access.context.userId,
      allowConflictOverride: canOverrideBookingConflict(access.context),
      respectLeadTime: false,
    }));
    const managementUrl = new URL(`/booking/manage/${encodeURIComponent(result.managementToken)}`, request.nextUrl.origin).toString();
    await runWithBranchApiContext(access.context, () => notifyBookingCreated(result.booking, managementUrl))
      .catch((error) => console.warn("[booking/admin-created-notification]", error));
    return NextResponse.json({ booking: bookingDto(result.booking), managementUrl }, { status: 201 });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
