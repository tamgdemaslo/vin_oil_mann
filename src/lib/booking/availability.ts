import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BOOKING_STATUS } from "./constants";
import { BookingError } from "./errors";
import {
  addLocalDays,
  assertLocalDate,
  formatLocalDate,
  localDateIsoWeekday,
  localDateUtcRange,
  localTimeToMinutes,
  minutesToLocalTime,
  zonedLocalToUtc,
} from "./timezone";

type BookingDb = Prisma.TransactionClient;

export type AvailabilityInput = {
  branchId: string;
  localDate: string;
  serviceIds: string[];
  masterMembershipId?: string | null;
  onlineOnly?: boolean;
  respectLeadTime?: boolean;
  excludeBookingId?: string | null;
  durationOverrideMinutes?: number | null;
  now?: Date;
};

export type BookingSlot = {
  startsAt: string;
  endsAt: string;
  localTime: string;
  durationMinutes: number;
  master: {
    membershipId: string;
    name: string;
    position: string | null;
  };
};

export type AvailabilityResult = {
  branch: { id: string; name: string; timezone: string };
  localDate: string;
  durationMinutes: number;
  stepMinutes: number;
  requiresVin: boolean;
  requiresConfirmation: boolean;
  slots: BookingSlot[];
};

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function intersectInterval(left: { start: number; end: number }, right: { start: number; end: number }) {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return start < end ? { start, end } : null;
}

function intervalFromHours(value: { isWorking: boolean; startTime: string | null; endTime: string | null } | null | undefined) {
  if (!value?.isWorking || !value.startTime || !value.endTime) return null;
  const start = localTimeToMinutes(value.startTime);
  const end = localTimeToMinutes(value.endTime);
  return start < end ? { start, end } : null;
}

export async function getBookingAvailability(input: AvailabilityInput, suppliedDb?: BookingDb): Promise<AvailabilityResult> {
  const db = suppliedDb ?? (prisma as unknown as BookingDb);
  const localDate = assertLocalDate(input.localDate);
  const serviceIds = uniqueStrings(input.serviceIds);
  if (!input.branchId) throw new BookingError("Филиал не указан", "booking_branch_required");
  if (!serviceIds.length) throw new BookingError("Выберите хотя бы одну услугу", "booking_services_required");

  const branch = await db.branch.findFirst({
    where: { id: input.branchId, status: "active" },
    select: { id: true, name: true, timezone: true, bookingSettings: true },
  });
  if (!branch) throw new BookingError("Филиал не найден", "booking_branch_not_found", 404);
  const settings = branch.bookingSettings;
  if (input.onlineOnly && !settings?.publicBookingEnabled) {
    throw new BookingError("Онлайн-запись в филиал временно закрыта", "booking_public_disabled", 423);
  }

  const services = await db.bookingService.findMany({
    where: {
      branchId: branch.id,
      id: { in: serviceIds },
      status: "ACTIVE",
      ...(input.onlineOnly ? { onlineBookingEnabled: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (services.length !== serviceIds.length) {
    throw new BookingError("Одна из услуг недоступна для записи", "booking_service_unavailable", 409);
  }

  const serviceDurationMinutes = services.reduce((total, service) => total + service.durationMinutes, 0);
  const durationMinutes = input.durationOverrideMinutes && input.durationOverrideMinutes >= 5
    ? Math.min(Math.trunc(input.durationOverrideMinutes), 1_440)
    : serviceDurationMinutes;
  if (durationMinutes <= 0) throw new BookingError("У услуг не настроена длительность", "booking_duration_invalid", 409);

  const now = input.now ?? new Date();
  const today = formatLocalDate(now, branch.timezone);
  const horizonDays = Math.max(1, Math.min(settings?.bookingHorizonDays ?? 60, 365));
  if (localDate < today || localDate > addLocalDays(today, horizonDays)) {
    throw new BookingError("Дата находится вне доступного периода записи", "booking_date_out_of_range", 409);
  }

  const assignments = await db.bookingMasterService.findMany({
    where: {
      branchId: branch.id,
      serviceId: { in: serviceIds },
      membership: {
        status: "active",
        user: { status: "active" },
      },
      ...(input.masterMembershipId ? { membershipId: input.masterMembershipId } : {}),
    },
    include: {
      membership: { include: { user: { select: { name: true } } } },
    },
  });

  const assignedServices = new Map<string, Set<string>>();
  const masters = new Map<string, { membershipId: string; name: string; position: string | null }>();
  for (const assignment of assignments) {
    const set = assignedServices.get(assignment.membershipId) ?? new Set<string>();
    set.add(assignment.serviceId);
    assignedServices.set(assignment.membershipId, set);
    masters.set(assignment.membershipId, {
      membershipId: assignment.membershipId,
      name: assignment.membership.user.name,
      position: assignment.membership.position,
    });
  }
  const candidateIds = [...masters.keys()].filter((id) => assignedServices.get(id)?.size === serviceIds.length);
  if (!candidateIds.length) {
    return {
      branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
      localDate,
      durationMinutes,
      stepMinutes: settings?.bookingStepMinutes ?? 30,
      requiresVin: services.some((service) => service.requiresVin),
      requiresConfirmation: services.some((service) => service.requiresConfirmation),
      slots: [],
    };
  }

  const weekday = localDateIsoWeekday(localDate);
  const [branchHours, masterHours, exceptions] = await Promise.all([
    db.branchBookingWorkingHour.findUnique({ where: { branchId_weekday: { branchId: branch.id, weekday } } }),
    db.bookingMasterWorkingHour.findMany({ where: { branchId: branch.id, membershipId: { in: candidateIds }, weekday } }),
    db.bookingScheduleException.findMany({ where: { branchId: branch.id, membershipId: { in: candidateIds }, localDate } }),
  ]);
  const branchInterval = intervalFromHours(branchHours);
  if (!branchInterval) {
    return {
      branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
      localDate,
      durationMinutes,
      stepMinutes: settings?.bookingStepMinutes ?? 30,
      requiresVin: services.some((service) => service.requiresVin),
      requiresConfirmation: services.some((service) => service.requiresConfirmation),
      slots: [],
    };
  }

  const dayRange = localDateUtcRange(localDate, branch.timezone);
  const busy = await db.booking.findMany({
    where: {
      branchId: branch.id,
      masterMembershipId: { in: candidateIds },
      status: BOOKING_STATUS.ACTIVE,
      startsAt: { lt: dayRange.end },
      endsAt: { gt: dayRange.start },
      ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
    },
    select: { id: true, masterMembershipId: true, startsAt: true, endsAt: true },
  });
  const busyByMaster = new Map<string, typeof busy>();
  for (const booking of busy) {
    if (!booking.masterMembershipId) continue;
    const values = busyByMaster.get(booking.masterMembershipId) ?? [];
    values.push(booking);
    busyByMaster.set(booking.masterMembershipId, values);
  }

  const masterHoursById = new Map(masterHours.map((row) => [row.membershipId, row]));
  const exceptionById = new Map(exceptions.map((row) => [row.membershipId, row]));
  const stepMinutes = Math.max(5, Math.min(settings?.bookingStepMinutes ?? 30, 240));
  const minimumLeadMinutes = input.respectLeadTime === false ? 0 : Math.max(0, settings?.minimumLeadMinutes ?? 60);
  const earliest = now.getTime() + minimumLeadMinutes * 60_000;
  const slots: BookingSlot[] = [];

  for (const membershipId of candidateIds) {
    const exception = exceptionById.get(membershipId);
    if (exception?.kind === "CLOSED") continue;
    const masterInterval = exception?.kind === "CUSTOM"
      ? intervalFromHours({ isWorking: true, startTime: exception.startTime, endTime: exception.endTime })
      : intervalFromHours(masterHoursById.get(membershipId));
    if (!masterInterval) continue;
    const working = intersectInterval(branchInterval, masterInterval);
    if (!working) continue;

    const firstMinute = Math.ceil(working.start / stepMinutes) * stepMinutes;
    for (let minute = firstMinute; minute + durationMinutes <= working.end; minute += stepMinutes) {
      const startsAt = zonedLocalToUtc(localDate, minutesToLocalTime(minute), branch.timezone);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      if (startsAt.getTime() < earliest) continue;
      const conflicts = (busyByMaster.get(membershipId) ?? []).some(
        (booking) => booking.startsAt < endsAt && booking.endsAt > startsAt,
      );
      if (conflicts) continue;
      slots.push({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        localTime: minutesToLocalTime(minute),
        durationMinutes,
        master: masters.get(membershipId)!,
      });
    }
  }

  slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.master.name.localeCompare(right.master.name, "ru"));
  return {
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    localDate,
    durationMinutes,
    stepMinutes,
    requiresVin: services.some((service) => service.requiresVin),
    requiresConfirmation: services.some((service) => service.requiresConfirmation),
    slots,
  };
}
