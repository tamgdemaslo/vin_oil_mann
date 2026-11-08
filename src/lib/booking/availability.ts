import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BOOKING_MASTER_ROLE_ID, BOOKING_STATUS } from "./constants";
import { DEFAULT_BOOKING_STEP_MINUTES, defaultBookingWorkingHour } from "./defaults";
import { BookingError } from "./errors";
import { retainsBookingAssignment } from "./existing-assignment";
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
  /** Set only by authenticated staff flows, never from public request data. */
  preserveExistingAssignment?: boolean;
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
  workingWindows: Array<{
    membershipId: string;
    startTime: string;
    endTime: string;
  }>;
  slots: BookingSlot[];
  reasonCode?: string;
  message?: string;
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

export type BookingDayLoad = {
  localDate: string;
  occupiedPercent: number | null;
  hasSlot: boolean | null;
};

export async function getBookingAvailability(input: AvailabilityInput, db?: BookingDb): Promise<AvailabilityResult> {
  const [{ load: _load, ...result }] = await getAvailabilityDays(input, null, db);
  return result;
}

export async function getBookingMonthLoad(input: Omit<AvailabilityInput, "localDate">, month: string, db?: BookingDb) {
  const localDate = assertLocalDate(`${month}-01`);
  const days = await getAvailabilityDays({ ...input, localDate }, month, db);
  return days.map(({ load }) => load);
}

async function getAvailabilityDays(input: AvailabilityInput, month: string | null, suppliedDb?: BookingDb) {
  const db = suppliedDb ?? (prisma as unknown as BookingDb);
  const localDate = assertLocalDate(input.localDate);
  const serviceIds = uniqueStrings(input.serviceIds);
  if (!input.branchId) throw new BookingError("Филиал не указан", "booking_branch_required");
  if (!month && !serviceIds.length) throw new BookingError("Выберите хотя бы одну услугу", "booking_services_required");

  const branch = await db.branch.findFirst({
    where: { id: input.branchId, status: "active" },
    select: { id: true, name: true, timezone: true, bookingSettings: true },
  });
  if (!branch) throw new BookingError("Филиал не найден", "booking_branch_not_found", 404);
  const settings = branch.bookingSettings;
  if (input.onlineOnly && !settings?.publicBookingEnabled) {
    throw new BookingError("Онлайн-запись в филиал временно закрыта", "booking_public_disabled", 423);
  }

  const services = serviceIds.length ? await db.bookingService.findMany({
    where: {
      branchId: branch.id,
      id: { in: serviceIds },
      status: "ACTIVE",
      ...(input.onlineOnly ? { onlineBookingEnabled: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  }) : [];
  if (services.length !== serviceIds.length) {
    throw new BookingError("Одна из услуг недоступна для записи", "booking_service_unavailable", 409);
  }

  const serviceDurationMinutes = services.reduce((total, service) => total + service.durationMinutes, 0);
  const durationMinutes = input.durationOverrideMinutes && input.durationOverrideMinutes >= 5
    ? Math.min(Math.trunc(input.durationOverrideMinutes), 1_440)
    : serviceDurationMinutes;
  if (serviceIds.length && durationMinutes <= 0) throw new BookingError("У услуг не настроена длительность", "booking_duration_invalid", 409);

  const now = input.now ?? new Date();
  const today = formatLocalDate(now, branch.timezone);
  const horizonDays = Math.max(1, Math.min(settings?.bookingHorizonDays ?? 60, 365));
  const lastBookableDate = addLocalDays(today, horizonDays);
  if (!month && (localDate < today || localDate > lastBookableDate)) {
    throw new BookingError("Дата находится вне доступного периода записи", "booking_date_out_of_range", 409);
  }

  const dates = month
    ? Array.from({ length: 31 }, (_, index) => addLocalDays(localDate, index))
      .filter((date) => date.startsWith(month) && date >= today && date <= lastBookableDate)
    : [localDate];
  if (!dates.length) return [];

  const assignments = serviceIds.length ? await db.bookingMasterService.findMany({
    where: {
      branchId: branch.id,
      serviceId: { in: serviceIds },
      membership: {
        roleId: BOOKING_MASTER_ROLE_ID,
        status: "active",
        user: { status: "active" },
      },
      ...(input.masterMembershipId ? { membershipId: input.masterMembershipId } : {}),
    },
    include: {
      membership: { include: { user: { select: { name: true } } } },
    },
  }) : [];

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
  if (month) {
    const memberships = await db.branchMembership.findMany({
      where: {
        branchId: branch.id,
        roleId: BOOKING_MASTER_ROLE_ID,
        status: "active",
        user: { status: "active" },
        ...(input.masterMembershipId ? { id: input.masterMembershipId } : {}),
      },
      include: { user: { select: { name: true } } },
    });
    for (const membership of memberships) {
      masters.set(membership.id, { membershipId: membership.id, name: membership.user.name, position: membership.position });
    }
  }
  // A time-only staff edit retains the original assignment even if the master
  // was subsequently disabled or removed from the service settings.
  if (input.preserveExistingAssignment && !input.onlineOnly && input.excludeBookingId) {
    const existing = await db.booking.findFirst({
      where: { id: input.excludeBookingId, branchId: branch.id, status: BOOKING_STATUS.ACTIVE },
      include: { serviceItems: { select: { serviceId: true } }, masterMembership: { include: { user: { select: { name: true, status: true } } } } },
    });
    const membership = existing?.masterMembership;
    if (membership?.roleId === BOOKING_MASTER_ROLE_ID && membership.user.status === "active"
      && retainsBookingAssignment(existing, input.masterMembershipId ?? existing?.masterMembershipId, serviceIds)) {
      masters.set(membership.id, { membershipId: membership.id, name: membership.user.name, position: membership.position });
      assignedServices.set(membership.id, new Set(serviceIds));
    }
  }
  const eligibleIds = new Set([...masters.keys()].filter((id) => assignedServices.get(id)?.size === serviceIds.length));
  const candidateIds = month ? [...masters.keys()] : [...eligibleIds];
  const baseResult = {
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    durationMinutes,
    stepMinutes: settings?.bookingStepMinutes ?? DEFAULT_BOOKING_STEP_MINUTES,
    requiresVin: services.some((service) => service.requiresVin),
    requiresConfirmation: services.some((service) => service.requiresConfirmation),
  };
  const emptyDay = (date: string, reasonCode: string, message: string) => ({
    ...baseResult, localDate: date, workingWindows: [], slots: [], reasonCode, message,
    load: { localDate: date, occupiedPercent: null, hasSlot: serviceIds.length ? false : null },
  });
  if (!candidateIds.length) {
    return dates.map((date) => emptyDay(date, "master_service_mismatch", input.masterMembershipId
      ? "Для выбранных услуг этот мастер не назначен"
      : "Для выбранных услуг не назначен мастер"));
  }

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const weekday = localDateIsoWeekday(firstDate);
  const [branchHours, masterHours, exceptions] = await Promise.all([
    month
      ? db.branchBookingWorkingHour.findMany({ where: { branchId: branch.id } })
      : db.branchBookingWorkingHour.findUnique({ where: { branchId_weekday: { branchId: branch.id, weekday } } })
        .then((row) => row ? [{ ...row, weekday }] : []),
    db.bookingMasterWorkingHour.findMany({ where: { branchId: branch.id, membershipId: { in: candidateIds }, ...(month ? {} : { weekday }) } }),
    db.bookingScheduleException.findMany({ where: { branchId: branch.id, membershipId: { in: candidateIds }, localDate: month ? { gte: firstDate, lte: lastDate } : firstDate } }),
  ]);
  const branchHoursByDay = new Map(branchHours.map((row) => [row.weekday, row]));
  const windowsByDate = new Map(dates.map((date) => {
    const day = localDateIsoWeekday(date);
    return [date, intervalFromHours(branchHoursByDay.get(day) ?? defaultBookingWorkingHour(day))];
  }));
  const busy = [...windowsByDate.values()].some(Boolean) ? await db.booking.findMany({
    where: {
      branchId: branch.id,
      masterMembershipId: { in: candidateIds },
      status: BOOKING_STATUS.ACTIVE,
      startsAt: { lt: localDateUtcRange(lastDate, branch.timezone).end },
      endsAt: { gt: localDateUtcRange(firstDate, branch.timezone).start },
      ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
    },
    select: { id: true, masterMembershipId: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
  }) : [];
  const busyByMaster = new Map<string, typeof busy>();
  for (const booking of busy) {
    if (!booking.masterMembershipId) continue;
    const values = busyByMaster.get(booking.masterMembershipId) ?? [];
    values.push(booking);
    busyByMaster.set(booking.masterMembershipId, values);
  }

  const masterHoursById = new Map(masterHours.map((row) => [`${month ? row.weekday : weekday}:${row.membershipId}`, row]));
  const exceptionById = new Map(exceptions.map((row) => [`${month ? row.localDate : firstDate}:${row.membershipId}`, row]));
  const stepMinutes = Math.max(5, Math.min(settings?.bookingStepMinutes ?? DEFAULT_BOOKING_STEP_MINUTES, 240));
  const minimumLeadMinutes = input.respectLeadTime === false ? 0 : Math.max(0, settings?.minimumLeadMinutes ?? 60);
  const earliest = now.getTime() + minimumLeadMinutes * 60_000;
  return dates.map((date): AvailabilityResult & { load: BookingDayLoad } => {
    const branchInterval = windowsByDate.get(date);
    if (!branchInterval) return emptyDay(date, "branch_closed", "Филиал не работает в выбранный день");
    const day = localDateIsoWeekday(date);
    const slots: BookingSlot[] = [];
    const workingWindows: AvailabilityResult["workingWindows"] = [];
    let closedByExceptionCount = 0;
    let workingMasterCount = 0;
    let potentialSlotCount = 0;
    let scheduledMs = 0;
    let occupiedMs = 0;

    for (const membershipId of candidateIds) {
      const exception = exceptionById.get(`${date}:${membershipId}`);
      if (exception?.kind === "CLOSED") {
        closedByExceptionCount += 1;
        continue;
      }
      const configuredMasterHours = masterHoursById.get(`${day}:${membershipId}`);
      const masterInterval = exception?.kind === "CUSTOM"
        ? intervalFromHours({ isWorking: true, startTime: exception.startTime, endTime: exception.endTime })
        : configuredMasterHours
          ? intervalFromHours(configuredMasterHours)
          : branchInterval;
      if (!masterInterval) continue;
      const working = intersectInterval(branchInterval, masterInterval);
      if (!working) continue;
      workingMasterCount += 1;
      workingWindows.push({
        membershipId,
        startTime: minutesToLocalTime(working.start),
        endTime: minutesToLocalTime(working.end),
      });

      let bookings = busyByMaster.get(membershipId) ?? [];
      if (month) {
        const start = zonedLocalToUtc(date, minutesToLocalTime(working.start), branch.timezone).getTime();
        const end = zonedLocalToUtc(date, minutesToLocalTime(working.end), branch.timezone).getTime();
        scheduledMs += end - start;
        bookings = bookings.filter((booking) => booking.startsAt.getTime() < end && booking.endsAt.getTime() > start);
        let cursor = start;
        for (const booking of bookings) {
          const busyStart = Math.max(cursor, booking.startsAt.getTime());
          const busyEnd = Math.min(end, booking.endsAt.getTime());
          if (busyEnd <= busyStart) continue;
          occupiedMs += busyEnd - busyStart;
          cursor = busyEnd;
        }
        if (!eligibleIds.has(membershipId) || slots.length) continue;
      }

      const firstMinute = Math.ceil(working.start / stepMinutes) * stepMinutes;
      for (let minute = firstMinute; minute + durationMinutes <= working.end; minute += stepMinutes) {
        const startsAt = zonedLocalToUtc(date, minutesToLocalTime(minute), branch.timezone);
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
        if (startsAt.getTime() < earliest) continue;
        potentialSlotCount += 1;
        const conflicts = bookings.some(
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
        if (month) break;
      }
    }

    slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.master.name.localeCompare(right.master.name, "ru"));
    const unavailable = slots.length === 0
      ? closedByExceptionCount === candidateIds.length
        ? { reasonCode: "master_closed", message: "Мастер не работает в этот день" }
        : workingMasterCount === 0
          ? { reasonCode: "master_not_working", message: "Мастер не работает в этот день" }
          : potentialSlotCount === 0
            ? {
                reasonCode: "duration_not_fit",
                message: `Для выбранных работ требуется ${durationMinutes} минут — в графике мастера нет подходящего окна`,
              }
            : { reasonCode: "day_fully_booked", message: "На выбранную дату свободных окон нет" }
      : {};
    const occupiedPercent = !scheduledMs ? null
      : occupiedMs === scheduledMs ? 100
        : occupiedMs ? Math.max(1, Math.min(99, Math.round(occupiedMs / scheduledMs * 100))) : 0;
    return {
      ...baseResult, localDate: date, stepMinutes, workingWindows, slots, ...unavailable,
      load: {
        localDate: date,
        occupiedPercent,
        hasSlot: serviceIds.length ? slots.length > 0 : null,
      },
    };
  });
}
