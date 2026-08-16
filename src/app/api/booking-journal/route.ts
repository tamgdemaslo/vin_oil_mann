import { NextRequest, NextResponse } from "next/server";
import { bookingViewIsSelfOnly, canConfirmBookings, canManageBookings, canOverrideBookingConflict, canViewBookings, requireBookingCapability } from "@/lib/booking/access";
import { bookingErrorPayload, BookingError } from "@/lib/booking/errors";
import { notifyBookingCancelled, notifyBookingConfirmed, notifyBookingCreated, notifyBookingRescheduled } from "@/lib/booking/notifications";
import {
  BOOKING_INCLUDE,
  bookingManagementToken,
  cancelBooking,
  confirmBooking,
  createBooking,
  rescheduleBooking,
  updateBookingDetails,
  type BookingWithDetails,
} from "@/lib/booking/service";
import { addLocalDays, zonedLocalToUtc } from "@/lib/booking/timezone";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function journalDateTime(value: string | null, timeZone: string) {
  if (!value) throw new BookingError("Укажите время записи", "booking_datetime_required");
  const local = value.match(/^(20\d{2}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/);
  if (local) return zonedLocalToUtc(local[1], local[2], timeZone);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BookingError("Некорректное время", "booking_datetime_invalid");
  return parsed;
}

function journalId(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}

function legacyUnassignedId(branchId: string) {
  return journalId(`legacy-unassigned:${branchId}`);
}

function idsFromPayload(payload: JsonObject) {
  return Array.isArray(payload.services)
    ? payload.services.map((item) => number(object(item).id ?? item)).filter((id): id is number => Boolean(id && id > 0))
    : [];
}

function parseComment(comment: string | null) {
  const clientLines: string[] = [];
  let internalComment: string | null = null;
  let vehicleText = "";
  let plate: string | null = null;
  let vin: string | null = null;
  for (const raw of (comment ?? "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^внутренний комментарий:/iu.test(line)) {
      internalComment = line.replace(/^внутренний комментарий:/iu, "").trim() || null;
      continue;
    }
    if (/^авто:/iu.test(line)) {
      const parts = line.replace(/^авто:/iu, "").trim().split(" · ").map((part) => part.trim()).filter(Boolean);
      vehicleText = parts.find((part) => !/^vin\s/iu.test(part) && !/^[а-яa-z]\d/iu.test(part)) ?? parts[0] ?? "";
      plate = parts.find((part) => /^[а-яa-z]\d/iu.test(part)) ?? null;
      vin = parts.find((part) => /^vin\s/iu.test(part))?.replace(/^vin\s*/iu, "").trim().toUpperCase() ?? null;
      continue;
    }
    clientLines.push(line);
  }
  const words = vehicleText.split(/\s+/u).filter(Boolean);
  return {
    comment: clientLines.join("\n") || null,
    internalComment,
    vehicle: {
      make: words[0] || "Автомобиль",
      model: words.slice(1).join(" ") || words[0] || "Не указан",
      plate,
      vin,
    },
  };
}

function statusAttendance(comment: string | null) {
  const normalized = (comment ?? "").toLowerCase();
  if (/не приехал|no[-_\s]?show/u.test(normalized)) return -1;
  if (/клиент приехал|в работе|готово|клиент уехал/u.test(normalized)) return 1;
  return 0;
}

function composeJournalComment(booking: BookingWithDetails) {
  const lines = [booking.comment?.trim() || ""];
  if (booking.vehicle) {
    const vehicle = [booking.vehicle.make, booking.vehicle.model, booking.vehicle.plate, booking.vehicle.vin ? `VIN ${booking.vehicle.vin}` : null].filter(Boolean).join(" · ");
    if (vehicle && !/^авто:/imu.test(booking.comment ?? "")) lines.push(`Авто: ${vehicle}`);
  }
  if (booking.internalComment && !/^внутренний комментарий:/imu.test(booking.comment ?? "")) {
    lines.push(`Внутренний комментарий: ${booking.internalComment}`);
  }
  return lines.filter(Boolean).join("\n");
}

function recordDto(booking: BookingWithDetails) {
  const comment = composeJournalComment(booking);
  const vehicle = booking.vehicle;
  return {
    id: journalId(booking.id),
    local_booking_id: booking.id,
    staff_id: booking.masterMembershipId ? journalId(booking.masterMembershipId) : legacyUnassignedId(booking.branchId),
    date: booking.startsAt.toISOString(),
    datetime: booking.startsAt.toISOString(),
    seance_length: booking.durationMinutes * 60,
    length: booking.durationMinutes * 60,
    comment,
    attendance: statusAttendance(comment),
    confirmed: booking.confirmationState === "PENDING" ? 0 : 1,
    online: booking.source === "PUBLIC",
    record_from: booking.source.toLowerCase(),
    status: booking.status.toLowerCase(),
    services: booking.serviceItems.map((item) => ({
      id: item.serviceId ? journalId(item.serviceId) : journalId(item.id),
      title: item.serviceNameSnapshot,
      cost: 0,
      price: 0,
    })),
    client: {
      id: booking.clientId ? journalId(booking.clientId) : null,
      display_name: booking.customerName,
      name: booking.customerName,
      phone: booking.phone,
      email: booking.email,
      is_new: booking.source === "PUBLIC",
    },
    vehicle: vehicle ? {
      model: [vehicle.make, vehicle.model].filter(Boolean).join(" "),
      plate: vehicle.plate,
      vin: vehicle.vin,
      year: vehicle.year ? String(vehicle.year) : "",
    } : null,
    vehicle_model: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(" ") : "",
    vehicle_plate: vehicle?.plate ?? "",
    vehicle_vin: vehicle?.vin ?? "",
    source: booking.source,
    requires_confirmation: booking.requiresConfirmation,
    confirmation_state: booking.confirmationState,
    conflict_override: booking.conflictOverride,
  };
}

async function bookingFromJournalId(branchId: string, rawId: unknown) {
  const directId = typeof rawId === "string" ? rawId.trim() : "";
  if (directId && !/^\d+$/u.test(directId)) {
    const direct = await prisma.booking.findFirst({
      where: { id: directId, branchId },
      include: BOOKING_INCLUDE,
    });
    if (!direct) throw new BookingError("Запись не найдена", "booking_not_found", 404);
    return direct;
  }
  const id = number(rawId);
  if (!id) throw new BookingError("Запись не найдена", "booking_not_found", 404);
  const rows = await prisma.booking.findMany({
    where: { branchId },
    include: BOOKING_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 5_000,
  });
  const booking = rows.find((row) => journalId(row.id) === id);
  if (!booking) throw new BookingError("Запись не найдена", "booking_not_found", 404);
  return booking;
}

async function resolveServiceIds(branchId: string, numericIds: number[]) {
  const services = await prisma.bookingService.findMany({ where: { branchId, status: "ACTIVE" }, select: { id: true } });
  const resolved = numericIds.map((numericId) => services.find((service) => journalId(service.id) === numericId)?.id).filter((id): id is string => Boolean(id));
  if (resolved.length !== numericIds.length) throw new BookingError("Одна из услуг не найдена", "booking_service_not_found", 404);
  return resolved;
}

async function resolveMembershipId(branchId: string, numericId: unknown) {
  const id = number(numericId);
  if (!id) throw new BookingError("Мастер не выбран", "booking_master_required");
  const memberships = await prisma.branchMembership.findMany({ where: { branchId, status: "active" }, select: { id: true } });
  const membership = memberships.find((item) => journalId(item.id) === id);
  if (!membership) throw new BookingError("Мастер не найден", "booking_master_not_found", 404);
  return membership.id;
}

function managementUrl(request: NextRequest, booking: BookingWithDetails) {
  return new URL(`/booking/manage/${encodeURIComponent(bookingManagementToken(booking))}`, request.nextUrl.origin).toString();
}

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canViewBookings(access.context));
    return await runWithBranchApiContext(access.context, async () => {
      const branchId = access.context.branchId!;
      const branch = access.context.branch!;
      const ownMembership = bookingViewIsSelfOnly(access.context)
        ? await prisma.branchMembership.findFirst({ where: { branchId, userId: access.context.userId, status: "active" }, select: { id: true } })
        : null;
      const action = request.nextUrl.searchParams.get("action");
      if (action === "config") return NextResponse.json({ success: true, data: {
        company_id: journalId(branchId),
        company_title: branch.displayName || branch.shortName || branch.name,
        can_manage: canManageBookings(access.context),
        can_override_conflict: canOverrideBookingConflict(access.context),
      } });
      if (action === "staff") {
        const memberships = await prisma.branchMembership.findMany({
          where: { branchId, status: "active", user: { status: "active" }, ...(bookingViewIsSelfOnly(access.context) ? { id: ownMembership?.id ?? "__none__" } : {}) },
          include: { user: { select: { name: true } }, bookingServices: { select: { serviceId: true } } },
          orderBy: [{ position: "asc" }, { user: { name: "asc" } }],
        });
        const hasUnassignedArchive = bookingViewIsSelfOnly(access.context) ? 0 : await prisma.booking.count({ where: { branchId, source: "LEGACY_YCLIENTS", masterMembershipId: null } });
        return NextResponse.json({ success: true, data: [
          ...memberships.map((membership) => ({ id: journalId(membership.id), name: membership.user.name, specialization: membership.position || membership.roleId, bookable: membership.bookingServices.length > 0 })),
          ...(hasUnassignedArchive ? [{ id: legacyUnassignedId(branchId), name: "Архив Yclients", specialization: "Исторические записи без сопоставленного сотрудника", bookable: true }] : []),
        ] });
      }
      if (action === "services") {
        const services = await prisma.bookingService.findMany({ where: { branchId, status: "ACTIVE" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
        return NextResponse.json({ success: true, data: services.map((service) => ({ id: journalId(service.id), title: service.name, seance_length: service.durationMinutes * 60, duration: service.durationMinutes * 60 })) });
      }
      if (action === "records") {
        const startDate = request.nextUrl.searchParams.get("start_date") ?? new Date().toISOString().slice(0, 10);
        const endDate = request.nextUrl.searchParams.get("end_date") ?? startDate;
        const start = zonedLocalToUtc(startDate, "00:00", branch.timezone);
        const end = zonedLocalToUtc(addLocalDays(endDate, 1), "00:00", branch.timezone);
        const staffRaw = request.nextUrl.searchParams.get("staff_id");
        const isUnassignedArchive = Number(staffRaw) === legacyUnassignedId(branchId);
        const requestedMembershipId = !bookingViewIsSelfOnly(access.context) && staffRaw && !isUnassignedArchive
          ? await resolveMembershipId(branchId, staffRaw)
          : null;
        const membershipId = bookingViewIsSelfOnly(access.context) ? ownMembership?.id ?? "__none__" : requestedMembershipId;
        const bookings = await prisma.booking.findMany({
          where: { branchId, startsAt: { lt: end }, endsAt: { gt: start }, ...(isUnassignedArchive ? { masterMembershipId: null, source: "LEGACY_YCLIENTS" } : membershipId ? { masterMembershipId: membershipId } : {}) },
          include: BOOKING_INCLUDE,
          orderBy: { startsAt: "asc" },
          take: 2_000,
        });
        return NextResponse.json({ success: true, data: bookings.map(recordDto) });
      }
      if (action === "record") {
        const booking = await bookingFromJournalId(branchId, request.nextUrl.searchParams.get("record_id"));
        if (bookingViewIsSelfOnly(access.context) && booking.masterMembershipId !== ownMembership?.id) {
          throw new BookingError("Запись не найдена", "booking_not_found", 404);
        }
        return NextResponse.json({ success: true, data: recordDto(booking) });
      }
      return NextResponse.json({ success: false, error: "Неизвестная операция журнала" }, { status: 400 });
    });
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
    const body = object(await request.json().catch(() => null));
    if (body.action !== "create-record") throw new BookingError("Неизвестная операция журнала", "booking_action_invalid");
    const payload = object(body.payload);
    const client = object(payload.client);
    const parsed = parseComment(text(payload.comment));
    const result = await runWithBranchApiContext(access.context, async () => {
      const branchId = access.context.branchId!;
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } });
      if (!branch) throw new BookingError("Филиал не найден", "booking_branch_not_found", 404);
      const serviceIds = await resolveServiceIds(branchId, idsFromPayload(payload));
      const membershipId = await resolveMembershipId(branchId, payload.staff_id);
      return createBooking({
        branchId,
        serviceIds,
        masterMembershipId: membershipId,
        startsAt: journalDateTime(text(payload.datetime), branch.timezone),
        customerName: text(client.name) ?? "",
        phone: text(client.phone) ?? "",
        email: text(client.email),
        vehicle: parsed.vehicle,
        comment: parsed.comment,
        internalComment: parsed.internalComment,
        source: "ADMIN",
        overrideConflict: payload.save_if_busy === true,
        durationOverrideMinutes: number(payload.seance_length) ? Math.max(5, Math.round(number(payload.seance_length)! / 60)) : null,
      }, {
        kind: "USER",
        userId: access.context.userId,
        allowConflictOverride: canOverrideBookingConflict(access.context),
        respectLeadTime: false,
      });
    });
    const url = managementUrl(request, result.booking);
    await runWithBranchApiContext(access.context, () => notifyBookingCreated(result.booking, url)).catch((error) => console.warn("[booking-journal/create-notification]", error));
    return NextResponse.json({ success: true, data: recordDto(result.booking) }, { status: 201 });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookings(access.context), "Нет права изменять записи");
    const body = object(await request.json().catch(() => null));
    if (body.action !== "update-record") throw new BookingError("Неизвестная операция журнала", "booking_action_invalid");
    const payload = object(body.payload);
    const client = object(payload.client);
    const parsed = parseComment(text(payload.comment));
    const result = await runWithBranchApiContext(access.context, async () => {
      const branchId = access.context.branchId!;
      let booking = await bookingFromJournalId(branchId, body.record_id);
      const numericServiceIds = idsFromPayload(payload);
      const serviceIds = numericServiceIds.length
        ? await resolveServiceIds(branchId, numericServiceIds)
        : booking.serviceItems.map((item) => item.serviceId).filter((id): id is string => Boolean(id));
      const membershipId = payload.staff_id ? await resolveMembershipId(branchId, payload.staff_id) : booking.masterMembershipId;
      if (!membershipId) throw new BookingError("Мастер не выбран", "booking_master_required");
      const startsAt = text(payload.datetime)
        ? journalDateTime(text(payload.datetime), booking.branch.timezone)
        : booking.startsAt;
      const durationMinutes = number(payload.seance_length) ? Math.max(5, Math.round(number(payload.seance_length)! / 60)) : booking.durationMinutes;
      const currentServiceIds = booking.serviceItems.map((item) => item.serviceId).filter((id): id is string => Boolean(id)).sort();
      const scheduleChanged = startsAt.getTime() !== booking.startsAt.getTime()
        || membershipId !== booking.masterMembershipId
        || durationMinutes !== booking.durationMinutes
        || serviceIds.slice().sort().join("|") !== currentServiceIds.join("|");
      if (scheduleChanged) {
        booking = await rescheduleBooking(booking.id, {
          startsAt,
          masterMembershipId: membershipId,
          serviceIds,
          durationOverrideMinutes: durationMinutes,
          overrideConflict: payload.save_if_busy === true,
        }, {
          kind: "USER",
          userId: access.context.userId,
          allowConflictOverride: canOverrideBookingConflict(access.context),
          respectLeadTime: false,
        });
      }
      booking = await updateBookingDetails(booking.id, {
        customerName: text(client.name) ?? booking.customerName,
        phone: text(client.phone) ?? booking.phone,
        email: text(client.email),
        comment: text(payload.comment) ?? parsed.comment,
        internalComment: parsed.internalComment,
        vehicle: parsed.vehicle,
      }, { kind: "USER", userId: access.context.userId });
      let confirmed = false;
      if (payload.confirmed === 1 && booking.requiresConfirmation && booking.confirmationState !== "CONFIRMED") {
        requireBookingCapability(canConfirmBookings(access.context), "Нет права подтверждать запись");
        booking = await confirmBooking(booking.id, { kind: "USER", userId: access.context.userId });
        confirmed = true;
      }
      return { booking, scheduleChanged, confirmed };
    });
    const url = managementUrl(request, result.booking);
    if (result.scheduleChanged) await runWithBranchApiContext(access.context, () => notifyBookingRescheduled(result.booking, url)).catch((error) => console.warn("[booking-journal/reschedule-notification]", error));
    if (result.confirmed) await runWithBranchApiContext(access.context, () => notifyBookingConfirmed(result.booking, url)).catch((error) => console.warn("[booking-journal/confirm-notification]", error));
    return NextResponse.json({ success: true, data: recordDto(result.booking) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookings(access.context), "Нет права отменять записи");
    const body = object(await request.json().catch(() => null));
    if (body.action !== "delete-record") throw new BookingError("Неизвестная операция журнала", "booking_action_invalid");
    const booking = await runWithBranchApiContext(access.context, async () => {
      const current = await bookingFromJournalId(access.context.branchId!, body.record_id);
      return cancelBooking(current.id, text(body.reason), { kind: "USER", userId: access.context.userId });
    });
    const url = managementUrl(request, booking);
    await runWithBranchApiContext(access.context, () => notifyBookingCancelled(booking, url)).catch((error) => console.warn("[booking-journal/cancel-notification]", error));
    return NextResponse.json({ success: true, data: recordDto(booking) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
