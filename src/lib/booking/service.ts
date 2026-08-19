import { Prisma, type Booking, type PrismaClient } from "@prisma/client";
import { isAnonymousRetailCounterparty } from "@/lib/anonymous-retail-counterparty";
import { createLocalAdminCounterparty } from "@/lib/local-inventory-admin";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { prisma } from "@/lib/db";
import {
  BOOKING_CONFIRMATION,
  BOOKING_MASTER_ROLE_ID,
  BOOKING_SOURCE,
  BOOKING_STATUS,
} from "./constants";
import { BookingError } from "./errors";
import { getBookingAvailability } from "./availability";
import { createManagementHandle, createManagementToken, verifyManagementToken } from "./management-token";
import { formatLocalDate } from "./timezone";

type BookingDb = Prisma.TransactionClient;

type BookingCreatePhase = "client" | "vehicle" | "booking" | "service_items" | "booking_reload" | "audit";

export type BookingVehicleInput = {
  make?: string | null;
  model?: string | null;
  generation?: string | null;
  year?: number | string | null;
  plate?: string | null;
  vin?: string | null;
};

export type CreateBookingInput = {
  branchId: string;
  serviceIds: string[];
  masterMembershipId: string;
  startsAt: string | Date;
  customerName: string;
  phone: string;
  email?: string | null;
  clientId?: string | null;
  vehicleId?: string | null;
  vehicle?: BookingVehicleInput | null;
  comment?: string | null;
  internalComment?: string | null;
  source?: string;
  overrideConflict?: boolean;
  durationOverrideMinutes?: number | null;
};

export type BookingActor = {
  kind: "PUBLIC" | "USER" | "MANAGE_LINK" | "SYSTEM";
  userId?: string | null;
  allowConflictOverride?: boolean;
  respectLeadTime?: boolean;
};

export type RescheduleBookingInput = {
  startsAt: string | Date;
  masterMembershipId?: string | null;
  serviceIds?: string[] | null;
  overrideConflict?: boolean;
  durationOverrideMinutes?: number | null;
};

export type UpdateBookingDetailsInput = {
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  comment?: string | null;
  internalComment?: string | null;
  vehicle?: BookingVehicleInput | null;
};

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: string | Date, field: string) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BookingError(`Некорректное поле ${field}`, "booking_datetime_invalid");
  }
  date.setSeconds(0, 0);
  return date;
}

function distinctIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function inBookingCreatePhase<T>(phase: BookingCreatePhase, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BookingError) throw error;
    console.error(`[booking/create:${phase}]`, error);
    const failureKind = error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code.toLowerCase()
      : error instanceof Prisma.PrismaClientValidationError
        ? "validation"
        : "unknown";
    throw new BookingError(
      "Не удалось выполнить операцию с записью",
      `booking_internal_${phase}_${failureKind}`,
      500,
    );
  }
}

function requiredServiceFields(services: Array<{ requiredFieldsJson: Prisma.JsonValue; requiresVin: boolean }>) {
  const fields = new Set<string>();
  for (const service of services) {
    if (service.requiresVin) fields.add("vin");
    if (Array.isArray(service.requiredFieldsJson)) {
      for (const value of service.requiredFieldsJson) {
        if (typeof value === "string") fields.add(value);
      }
    }
  }
  return fields;
}

function normalizeYear(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const year = Number.parseInt(String(value), 10);
  const maximum = new Date().getUTCFullYear() + 1;
  if (!Number.isInteger(year) || year < 1900 || year > maximum) {
    throw new BookingError("Некорректный год автомобиля", "booking_vehicle_year_invalid");
  }
  return year;
}

async function lockKeys(tx: BookingDb, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

async function loadServices(tx: BookingDb, branchId: string, serviceIds: string[], onlineOnly: boolean) {
  const ids = distinctIds(serviceIds);
  if (!ids.length) throw new BookingError("Выберите хотя бы одну услугу", "booking_services_required");
  const services = await tx.bookingService.findMany({
    where: {
      branchId,
      id: { in: ids },
      status: "ACTIVE",
      ...(onlineOnly ? { onlineBookingEnabled: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (services.length !== ids.length) {
    throw new BookingError("Одна из услуг недоступна", "booking_service_unavailable", 409);
  }
  const durationMinutes = services.reduce((total, service) => total + service.durationMinutes, 0);
  if (durationMinutes <= 0) throw new BookingError("У услуг не настроена длительность", "booking_duration_invalid", 409);
  return { services, ids, durationMinutes };
}

async function assertMasterAssignments(tx: BookingDb, branchId: string, membershipId: string, serviceIds: string[]) {
  const membership = await tx.branchMembership.findFirst({
    where: {
      id: membershipId,
      branchId,
      roleId: BOOKING_MASTER_ROLE_ID,
      status: "active",
      user: { status: "active" },
    },
    include: { user: { select: { name: true } } },
  });
  if (!membership) throw new BookingError("Мастер недоступен", "booking_master_unavailable", 409);
  const count = await tx.bookingMasterService.count({
    where: { branchId, membershipId, serviceId: { in: serviceIds } },
  });
  if (count !== serviceIds.length) {
    throw new BookingError("Мастер не выполняет все выбранные услуги", "booking_master_service_mismatch", 409);
  }
  return membership;
}

async function assertNoOverlap(
  tx: BookingDb,
  input: { branchId: string; masterMembershipId: string; startsAt: Date; endsAt: Date; excludeBookingId?: string | null },
  override: boolean,
) {
  const conflicts = await tx.booking.findMany({
    where: {
      branchId: input.branchId,
      masterMembershipId: input.masterMembershipId,
      status: BOOKING_STATUS.ACTIVE,
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
    },
    select: { id: true, startsAt: true, endsAt: true, customerName: true },
    orderBy: { startsAt: "asc" },
  });
  if (conflicts.length && !override) {
    throw new BookingError("Это время уже занято", "booking_slot_taken", 409, {
      conflicts: conflicts.map((conflict) => ({
        id: conflict.id,
        startsAt: conflict.startsAt.toISOString(),
        endsAt: conflict.endsAt.toISOString(),
        customerName: conflict.customerName,
      })),
    });
  }
  return conflicts;
}

async function assertAvailableSlot(
  tx: BookingDb,
  input: {
    branchId: string;
    serviceIds: string[];
    masterMembershipId: string;
    startsAt: Date;
    onlineOnly: boolean;
    respectLeadTime: boolean;
    excludeBookingId?: string | null;
    durationOverrideMinutes?: number | null;
  },
) {
  const branch = await tx.branch.findUnique({ where: { id: input.branchId }, select: { timezone: true } });
  if (!branch) throw new BookingError("Филиал не найден", "booking_branch_not_found", 404);
  const localDate = formatLocalDate(input.startsAt, branch.timezone);
  const availability = await getBookingAvailability({
    branchId: input.branchId,
    localDate,
    serviceIds: input.serviceIds,
    masterMembershipId: input.masterMembershipId,
    onlineOnly: input.onlineOnly,
    respectLeadTime: input.respectLeadTime,
    excludeBookingId: input.excludeBookingId,
    durationOverrideMinutes: input.durationOverrideMinutes,
  }, tx);
  const exact = availability.slots.some((slot) => slot.startsAt === input.startsAt.toISOString());
  if (!exact) throw new BookingError("Выбранное время больше недоступно", "booking_slot_taken", 409);
}

async function resolveClient(
  tx: BookingDb,
  input: CreateBookingInput,
  normalizedPhone: string,
) {
  if (input.clientId) {
    const client = await tx.localCounterparty.findFirst({
      where: { id: input.clientId, branchId: input.branchId, archived: false },
    });
    if (!client) throw new BookingError("Клиент не найден", "booking_client_not_found", 404);
    if (isAnonymousRetailCounterparty(client)) {
      throw new BookingError("Для записи нужно указать реального клиента", "booking_client_required", 400);
    }
    return client;
  }
  const matches = await tx.localCounterparty.findMany({
    where: { branchId: input.branchId, normalizedPhone, archived: false },
    orderBy: { updatedAt: "desc" },
    take: 2,
  });
  if (matches.length === 1) return matches[0];
  const created = await createLocalAdminCounterparty({
    name: input.customerName.trim(),
    phone: input.phone.trim(),
    email: clean(input.email) ?? undefined,
    category: "INDIVIDUAL",
    vehicleModel: [clean(input.vehicle?.make), clean(input.vehicle?.model)].filter(Boolean).join(" ") || undefined,
    vehiclePlate: clean(input.vehicle?.plate) ?? undefined,
    vehicleVin: clean(input.vehicle?.vin) ?? undefined,
    vehicleYear: input.vehicle?.year == null ? undefined : String(input.vehicle.year),
  }, input.branchId, {
    transaction: tx,
    rawMetadata: { source: "booking" },
  });
  if (!created.ok) throw new BookingError(created.error, "booking_client_create_failed", 409);
  const client = await tx.localCounterparty.findFirst({
    where: { id: created.counterparty.id, branchId: input.branchId },
  });
  if (!client) throw new BookingError("Не удалось сохранить клиента", "booking_client_create_failed", 500);
  return client;
}

async function resolveVehicle(tx: BookingDb, input: CreateBookingInput, clientId: string) {
  if (input.vehicleId) {
    const vehicle = await tx.clientVehicle.findFirst({
      where: { id: input.vehicleId, branchId: input.branchId, counterpartyId: clientId, status: "ACTIVE" },
    });
    if (!vehicle) throw new BookingError("Автомобиль клиента не найден", "booking_vehicle_not_found", 404);
    return vehicle;
  }
  const make = clean(input.vehicle?.make);
  const model = clean(input.vehicle?.model);
  if (!make || !model) {
    throw new BookingError("Укажите марку и модель автомобиля", "booking_vehicle_required");
  }
  const vin = clean(input.vehicle?.vin)?.toUpperCase() ?? null;
  const plate = clean(input.vehicle?.plate)?.toUpperCase() ?? null;
  const existing = vin || plate
    ? await tx.clientVehicle.findFirst({
        where: {
          branchId: input.branchId,
          counterpartyId: clientId,
          status: "ACTIVE",
          OR: [vin ? { vin } : null, plate ? { plate } : null].filter((value): value is { vin: string } | { plate: string } => Boolean(value)),
        },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  if (existing) return existing;
  return tx.clientVehicle.create({
    data: {
      branchId: input.branchId,
      counterpartyId: clientId,
      make,
      model,
      generation: clean(input.vehicle?.generation),
      year: normalizeYear(input.vehicle?.year),
      plate,
      vin,
    },
  });
}

export const BOOKING_INCLUDE = {
  branch: { select: { id: true, businessGroupId: true, name: true, address: true, phone: true, timezone: true, legacyOrganizationId: true } },
  client: { select: { id: true, name: true, phone: true, email: true } },
  vehicle: true,
  masterMembership: { include: { user: { select: { id: true, name: true } } } },
  serviceItems: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.BookingInclude;

export async function createBooking(input: CreateBookingInput, actor: BookingActor) {
  const customerName = input.customerName?.trim();
  const normalizedPhone = normalizePhoneKey(input.phone);
  if (!customerName) throw new BookingError("Укажите имя клиента", "booking_customer_name_required");
  if (!normalizedPhone) throw new BookingError("Укажите корректный телефон", "booking_phone_invalid");
  if (!input.branchId) throw new BookingError("Филиал не указан", "booking_branch_required");
  if (!input.masterMembershipId) throw new BookingError("Мастер не выбран", "booking_master_required");
  const startsAt = dateValue(input.startsAt, "startsAt");
  const wantsOverride = Boolean(input.overrideConflict);
  if (wantsOverride && !actor.allowConflictOverride) {
    throw new BookingError("Нет права создавать пересекающиеся записи", "booking_override_forbidden", 403);
  }
  // Validate the signing configuration before any durable write. A booking
  // must never commit and then fail while its management link is generated.
  const managementHandle = createManagementHandle();
  const managementToken = createManagementToken(managementHandle, 1);

  const created = await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
    await lockKeys(tx, [`booking-master:${input.branchId}:${input.masterMembershipId}`]);
    const onlineOnly = actor.kind === "PUBLIC";
    const loaded = await loadServices(tx, input.branchId, input.serviceIds, onlineOnly);
    const { services, ids } = loaded;
    const durationMinutes = actor.kind !== "PUBLIC" && actor.kind !== "MANAGE_LINK" && input.durationOverrideMinutes && input.durationOverrideMinutes >= 5
      ? Math.min(Math.trunc(input.durationOverrideMinutes), 1_440)
      : loaded.durationMinutes;
    await assertMasterAssignments(tx, input.branchId, input.masterMembershipId, ids);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    if (!wantsOverride) {
      await assertAvailableSlot(tx, {
        branchId: input.branchId,
        serviceIds: ids,
        masterMembershipId: input.masterMembershipId,
        startsAt,
        onlineOnly,
        respectLeadTime: actor.respectLeadTime !== false,
        durationOverrideMinutes: durationMinutes,
      });
    }
    await assertNoOverlap(tx, {
      branchId: input.branchId,
      masterMembershipId: input.masterMembershipId,
      startsAt,
      endsAt,
    }, wantsOverride);
    const requiresVin = services.some((service) => service.requiresVin);
    const vehicleVin = clean(input.vehicle?.vin)?.toUpperCase() ?? null;
    if (requiresVin && !vehicleVin && !input.vehicleId) {
      throw new BookingError("Для выбранной услуги нужен VIN", "booking_vin_required");
    }

    const client = await inBookingCreatePhase("client", () => resolveClient(tx, input, normalizedPhone));
    const vehicle = await inBookingCreatePhase("vehicle", () => resolveVehicle(tx, input, client.id));
    const requiredFields = requiredServiceFields(services);
    if (requiresVin && !vehicle.vin) {
      throw new BookingError("Для выбранной услуги нужен VIN", "booking_vin_required");
    }
    if (requiredFields.has("email") && !clean(input.email)) {
      throw new BookingError("Для выбранной услуги нужен email", "booking_email_required");
    }
    if (requiredFields.has("plate") && !vehicle.plate) {
      throw new BookingError("Для выбранной услуги нужен госномер", "booking_plate_required");
    }
    if (requiredFields.has("year") && !vehicle.year) {
      throw new BookingError("Для выбранной услуги нужен год автомобиля", "booking_vehicle_year_required");
    }
    const requiresConfirmation = services.some((service) => service.requiresConfirmation);
    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) throw new BookingError("Филиал не найден", "booking_branch_not_found", 404);

    const bookingRow = await inBookingCreatePhase("booking", () => tx.booking.create({
      data: {
        branchId: input.branchId,
        clientId: client.id,
        vehicleId: vehicle.id,
        masterMembershipId: input.masterMembershipId,
        customerName,
        phone: input.phone.trim(),
        normalizedPhone,
        email: clean(input.email),
        vehicleSnapshot: {
          make: vehicle.make,
          model: vehicle.model,
          generation: vehicle.generation,
          year: vehicle.year,
          plate: vehicle.plate,
          vin: vehicle.vin,
        },
        vin: vehicle.vin,
        startsAt,
        endsAt,
        durationMinutes,
        source: input.source ?? (actor.kind === "PUBLIC" ? BOOKING_SOURCE.PUBLIC : BOOKING_SOURCE.ADMIN),
        requiresConfirmation,
        confirmationState: requiresConfirmation ? BOOKING_CONFIRMATION.PENDING : BOOKING_CONFIRMATION.NOT_REQUIRED,
        comment: clean(input.comment),
        internalComment: actor.kind === "USER" ? clean(input.internalComment) : null,
        conflictOverride: wantsOverride,
        managementHandle,
        createdByUserId: actor.userId ?? null,
      },
      select: { id: true },
    }));
    await inBookingCreatePhase("service_items", () => tx.bookingServiceItem.createMany({
      data: services.map((service, index) => ({
        branchId: input.branchId,
        bookingId: bookingRow.id,
        serviceId: service.id,
        serviceNameSnapshot: service.name,
        durationMinutesSnapshot: service.durationMinutes,
        sortOrder: index,
      })),
    }));
    const booking = await inBookingCreatePhase("booking_reload", () => tx.booking.findUnique({
      where: { id: bookingRow.id },
      include: BOOKING_INCLUDE,
    }));
    if (!booking) throw new BookingError("Не удалось сохранить запись", "booking_create_failed", 500);
    await inBookingCreatePhase("audit", () => tx.branchAuditLog.create({
      data: {
        businessGroupId: branch.businessGroupId,
        branchId: branch.id,
        userId: actor.userId ?? null,
        action: "booking.created",
        entityType: "booking",
        entityId: booking.id,
        metadata: {
          source: booking.source,
          startsAt: booking.startsAt.toISOString(),
          durationMinutes: booking.durationMinutes,
          endsAt: booking.endsAt.toISOString(),
          masterMembershipId: booking.masterMembershipId,
          serviceIds: ids,
          conflictOverride: booking.conflictOverride,
        },
      },
    }));
    return booking;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return {
    booking: created,
    managementToken,
  };
}

export async function getBookingByManagementToken(token: string) {
  const parsed = verifyManagementToken(token);
  const booking = await prisma.booking.findFirst({
    where: {
      managementHandle: parsed.handle,
      managementTokenVersion: parsed.version,
    },
    include: BOOKING_INCLUDE,
  });
  if (!booking) throw new BookingError("Запись не найдена", "booking_not_found", 404);
  return booking;
}

export async function rescheduleBooking(bookingId: string, input: RescheduleBookingInput, actor: BookingActor) {
  const startsAt = dateValue(input.startsAt, "startsAt");
  const wantsOverride = Boolean(input.overrideConflict);
  if (wantsOverride && !actor.allowConflictOverride) {
    throw new BookingError("Нет права переносить запись с пересечением", "booking_override_forbidden", 403);
  }
  return (prisma as unknown as PrismaClient).$transaction(async (tx) => {
    await lockKeys(tx, [`booking:${bookingId}`]);
    const current = await tx.booking.findFirst({
      where: { id: bookingId },
      include: { serviceItems: true, branch: true },
    });
    if (!current) throw new BookingError("Запись не найдена", "booking_not_found", 404);
    if (current.status !== BOOKING_STATUS.ACTIVE) {
      throw new BookingError("Отменённую запись нельзя перенести", "booking_cancelled", 409);
    }
    const masterMembershipId = input.masterMembershipId ?? current.masterMembershipId;
    if (!masterMembershipId) throw new BookingError("Мастер не выбран", "booking_master_required");
    await lockKeys(tx, [
      `booking-master:${current.branchId}:${masterMembershipId}`,
      ...(current.masterMembershipId ? [`booking-master:${current.branchId}:${current.masterMembershipId}`] : []),
    ]);
    const serviceIds = input.serviceIds?.length
      ? input.serviceIds
      : current.serviceItems.map((item) => item.serviceId).filter((id): id is string => Boolean(id));
    const onlineOnly = actor.kind === "MANAGE_LINK";
    const loaded = await loadServices(tx, current.branchId, serviceIds, onlineOnly);
    const { services, ids } = loaded;
    const durationMinutes = actor.kind !== "PUBLIC" && actor.kind !== "MANAGE_LINK" && input.durationOverrideMinutes && input.durationOverrideMinutes >= 5
      ? Math.min(Math.trunc(input.durationOverrideMinutes), 1_440)
      : loaded.durationMinutes;
    await assertMasterAssignments(tx, current.branchId, masterMembershipId, ids);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    if (!wantsOverride) {
      await assertAvailableSlot(tx, {
        branchId: current.branchId,
        serviceIds: ids,
        masterMembershipId,
        startsAt,
        onlineOnly,
        respectLeadTime: actor.respectLeadTime !== false,
        excludeBookingId: current.id,
        durationOverrideMinutes: durationMinutes,
      });
    }
    await assertNoOverlap(tx, {
      branchId: current.branchId,
      masterMembershipId,
      startsAt,
      endsAt,
      excludeBookingId: current.id,
    }, wantsOverride);

    if (input.serviceIds?.length) {
      await tx.bookingServiceItem.deleteMany({ where: { branchId: current.branchId, bookingId: current.id } });
      await tx.bookingServiceItem.createMany({
        data: services.map((service, index) => ({
          branchId: current.branchId,
          bookingId: current.id,
          serviceId: service.id,
          serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
          sortOrder: index,
        })),
      });
    }
    const requiresConfirmation = services.some((service) => service.requiresConfirmation);
    const booking = await tx.booking.update({
      where: { branchId_id: { branchId: current.branchId, id: current.id } },
      data: {
        masterMembershipId,
        startsAt,
        endsAt,
        durationMinutes,
        requiresConfirmation,
        confirmationState: requiresConfirmation ? BOOKING_CONFIRMATION.PENDING : BOOKING_CONFIRMATION.NOT_REQUIRED,
        confirmedAt: null,
        confirmedBy: null,
        conflictOverride: wantsOverride,
      },
      include: BOOKING_INCLUDE,
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: current.branch.businessGroupId,
        branchId: current.branchId,
        userId: actor.userId ?? null,
        action: "booking.rescheduled",
        entityType: "booking",
        entityId: current.id,
        metadata: {
          previousStartsAt: current.startsAt.toISOString(),
          startsAt: booking.startsAt.toISOString(),
          previousMasterMembershipId: current.masterMembershipId,
          masterMembershipId,
          previousDurationMinutes: current.durationMinutes,
          durationMinutes: booking.durationMinutes,
          serviceIds: ids,
          conflictOverride: booking.conflictOverride,
          actor: actor.kind,
        },
      },
    });
    return booking;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelBooking(bookingId: string, reason: string | null, actor: BookingActor) {
  return (prisma as unknown as PrismaClient).$transaction(async (tx) => {
    await lockKeys(tx, [`booking:${bookingId}`]);
    const current = await tx.booking.findFirst({ where: { id: bookingId }, include: BOOKING_INCLUDE });
    if (!current) throw new BookingError("Запись не найдена", "booking_not_found", 404);
    if (current.status === BOOKING_STATUS.CANCELLED) return current;
    const booking = await tx.booking.update({
      where: { branchId_id: { branchId: current.branchId, id: current.id } },
      data: {
        status: BOOKING_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: actor.userId ?? actor.kind,
        cancellationReason: clean(reason),
      },
      include: BOOKING_INCLUDE,
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: current.branch.businessGroupId,
        branchId: current.branchId,
        userId: actor.userId ?? null,
        action: "booking.cancelled",
        entityType: "booking",
        entityId: current.id,
        metadata: { reason: clean(reason), actor: actor.kind },
      },
    });
    return booking;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateBookingDetails(bookingId: string, input: UpdateBookingDetailsInput, actor: BookingActor) {
  return (prisma as unknown as PrismaClient).$transaction(async (tx) => {
    await lockKeys(tx, [`booking:${bookingId}`]);
    const current = await tx.booking.findFirst({ where: { id: bookingId }, include: BOOKING_INCLUDE });
    if (!current) throw new BookingError("Запись не найдена", "booking_not_found", 404);
    if (current.status !== BOOKING_STATUS.ACTIVE) throw new BookingError("Отменённую запись нельзя изменить", "booking_cancelled", 409);
    const customerName = clean(input.customerName) ?? current.customerName;
    const phone = clean(input.phone) ?? current.phone;
    const normalizedPhone = normalizePhoneKey(phone);
    if (!normalizedPhone) throw new BookingError("Укажите корректный телефон", "booking_phone_invalid");
    const nextVehicle = input.vehicle ?? null;
    let vehicle = current.vehicle;
    if (vehicle && nextVehicle) {
      vehicle = await tx.clientVehicle.update({
        where: { branchId_id: { branchId: current.branchId, id: vehicle.id } },
        data: {
          make: clean(nextVehicle.make) ?? vehicle.make,
          model: clean(nextVehicle.model) ?? vehicle.model,
          generation: nextVehicle.generation === undefined ? undefined : clean(nextVehicle.generation),
          year: nextVehicle.year === undefined ? undefined : normalizeYear(nextVehicle.year),
          plate: nextVehicle.plate === undefined ? undefined : clean(nextVehicle.plate)?.toUpperCase() ?? null,
          vin: nextVehicle.vin === undefined ? undefined : clean(nextVehicle.vin)?.toUpperCase() ?? null,
        },
      });
    }
    if (current.clientId) {
      await tx.localCounterparty.update({
        where: { branchId_id: { branchId: current.branchId, id: current.clientId } },
        data: {
          name: customerName,
          displayName: customerName,
          phone,
          normalizedPhone,
          email: input.email === undefined ? undefined : clean(input.email),
          searchText: [customerName, phone, normalizedPhone, vehicle?.make, vehicle?.model, vehicle?.plate, vehicle?.vin].filter(Boolean).join(" ").toLowerCase(),
          syncedAt: new Date(),
        },
      });
    }
    const booking = await tx.booking.update({
      where: { branchId_id: { branchId: current.branchId, id: current.id } },
      data: {
        customerName,
        phone,
        normalizedPhone,
        email: input.email === undefined ? undefined : clean(input.email),
        comment: input.comment === undefined ? undefined : clean(input.comment),
        internalComment: input.internalComment === undefined ? undefined : clean(input.internalComment),
        vin: vehicle?.vin ?? current.vin,
        vehicleSnapshot: (vehicle ? {
          make: vehicle.make,
          model: vehicle.model,
          generation: vehicle.generation,
          year: vehicle.year,
          plate: vehicle.plate,
          vin: vehicle.vin,
        } : current.vehicleSnapshot ?? {}) as Prisma.InputJsonValue,
      },
      include: BOOKING_INCLUDE,
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: current.branch.businessGroupId,
        branchId: current.branchId,
        userId: actor.userId ?? null,
        action: "booking.details.updated",
        entityType: "booking",
        entityId: current.id,
        metadata: { actor: actor.kind },
      },
    });
    return booking;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function confirmBooking(bookingId: string, actor: BookingActor) {
  return (prisma as unknown as PrismaClient).$transaction(async (tx) => {
    await lockKeys(tx, [`booking:${bookingId}`]);
    const current = await tx.booking.findFirst({ where: { id: bookingId }, include: BOOKING_INCLUDE });
    if (!current) throw new BookingError("Запись не найдена", "booking_not_found", 404);
    if (current.status !== BOOKING_STATUS.ACTIVE) {
      throw new BookingError("Отменённую запись нельзя подтвердить", "booking_cancelled", 409);
    }
    if (!current.requiresConfirmation) return current;
    const booking = await tx.booking.update({
      where: { branchId_id: { branchId: current.branchId, id: current.id } },
      data: {
        confirmationState: BOOKING_CONFIRMATION.CONFIRMED,
        confirmedAt: new Date(),
        confirmedBy: actor.userId ?? actor.kind,
      },
      include: BOOKING_INCLUDE,
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: current.branch.businessGroupId,
        branchId: current.branchId,
        userId: actor.userId ?? null,
        action: "booking.confirmed",
        entityType: "booking",
        entityId: current.id,
        metadata: { actor: actor.kind },
      },
    });
    return booking;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type BookingWithDetails = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

export function bookingManagementToken(booking: Pick<Booking, "managementHandle" | "managementTokenVersion">) {
  return createManagementToken(booking.managementHandle, booking.managementTokenVersion);
}
