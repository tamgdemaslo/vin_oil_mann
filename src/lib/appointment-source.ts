import {
  appointmentDateTime,
  type AppointmentLike,
} from "@/lib/appointment-shipment-reconcile";
import { BOOKING_INCLUDE, type BookingWithDetails } from "@/lib/booking/service";
import { formatLocalTime, localDateUtcRange } from "@/lib/booking/timezone";
import { prisma } from "@/lib/db";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";

function attendanceFromBooking(booking: BookingWithDetails) {
  const comment = `${booking.comment ?? ""}\n${booking.internalComment ?? ""}`.toLowerCase();
  if (/не приехал|no[-_\s]?show/u.test(comment)) return -1;
  if (/клиент приехал|в работе|готово|клиент уехал/u.test(comment)) return 1;
  return 0;
}

function appointmentRow(booking: BookingWithDetails, localDate: string): AppointmentLike {
  const vehicle = booking.vehicle;
  return {
    id: booking.id,
    localBookingId: booking.id,
    createdAt: booking.createdAt.toISOString(),
    date: booking.startsAt.toISOString(),
    datetime: booking.startsAt.toISOString(),
    staff_id: booking.masterMembershipId,
    seance_length: booking.durationMinutes * 60,
    length: booking.durationMinutes * 60,
    comment: [booking.comment, booking.internalComment].filter(Boolean).join("\n"),
    attendance: attendanceFromBooking(booking),
    confirmed: booking.confirmationState === "PENDING" ? 0 : 1,
    status: booking.status.toLowerCase(),
    slot: {
      id: `${localDate}-${formatLocalTime(booking.startsAt, booking.branch.timezone).replace(":", "")}`,
      date: localDate,
      day: localDate,
      time: formatLocalTime(booking.startsAt, booking.branch.timezone),
      available: false,
    },
    services: booking.serviceItems.map((item) => ({ title: item.serviceNameSnapshot })),
    client: {
      id: booking.clientId ?? undefined,
      display_name: booking.customerName,
      name: booking.customerName,
      phone: booking.phone,
      is_new: booking.source === "PUBLIC",
    },
    vehicle: vehicle ? {
      model: [vehicle.make, vehicle.model].filter(Boolean).join(" "),
      plate: vehicle.plate,
      vin: vehicle.vin,
      year: vehicle.year,
    } : undefined,
    vehicle_model: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(" ") : "",
    vehicle_plate: vehicle?.plate ?? "",
    vehicle_vin: vehicle?.vin ?? "",
    source: booking.source === "LEGACY_YCLIENTS" ? "yclients" : "local",
  };
}

export async function listAppointmentRowsForDate(date: string): Promise<AppointmentLike[]> {
  const branchId = getScopedBranchId();
  const tenant = getRequestTenant();
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { timezone: true },
  });
  if (!branch) return [];
  const selfOnly = tenant?.permissions?.some((role) => role === "master" || role === "mechanic")
    && !tenant.permissions.some((role) => ["group_owner", "group_admin", "branch_owner", "administrator"].includes(role));
  const ownMembership = selfOnly && tenant?.userId
    ? await prisma.branchMembership.findFirst({ where: { branchId, userId: tenant.userId, status: "active" }, select: { id: true } })
    : null;
  const range = localDateUtcRange(date, branch.timezone);
  const bookings = await prisma.booking.findMany({
    where: {
      branchId,
      status: "ACTIVE",
      ...(selfOnly ? { masterMembershipId: ownMembership?.id ?? "__none__" } : {}),
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
    },
    include: BOOKING_INCLUDE,
    orderBy: { startsAt: "asc" },
    take: 2_000,
  });
  return bookings
    .map((booking) => appointmentRow(booking, date))
    .sort((left, right) => (appointmentDateTime(left)?.getTime() ?? 0) - (appointmentDateTime(right)?.getTime() ?? 0));
}

/**
 * Compatibility export for consumers that still distinguish imported history.
 * It reads the local archive and never calls Yclients.
 */
export async function listYclientsAppointmentsForDate(date: string): Promise<AppointmentLike[]> {
  return (await listAppointmentRowsForDate(date)).filter((appointment) => appointment.source === "yclients");
}
