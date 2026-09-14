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
import { isValidBookingCustomerName } from "./customer-name";
import { publicBookingIdempotencyAuditId } from "./idempotency";
import { createManagementHandle, createManagementToken, verifyManagementToken } from "./management-token";
import { formatLocalDate, formatLocalTime, localTimeToMinutes } from "./timezone";

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

export type BookingOverrideReason = "slot_taken" | "outside_schedule" | "nonstandard_start";

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
  overrideReason?: BookingOverrideReason | null;
  durationOverrideMinutes?: number | null;
  idempotencyKey?: string | null;
  needsVehicleClarification?: boolean;
};

export const BOOKING_VEHICLE_CLARIFICATION_MARKER = "[Публичная запись: клиент не знает VIN, нужна помощь с подбором]";

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
  overrideReason?: BookingOverrideReason | null;
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

export type UpdateBookingInput = UpdateBookingDetailsInput & {
  startsAt?: string | Date | null;
  masterMembershipId?: string | null;
  serviceIds?: string[] | null;
  durationOverrideMinutes?: number | null;
  overrideConflict?: boolean;
  overrideReason?: BookingOverrideReason | null;
  clientId?: string | null;
  vehicleId?: string | null;
  confirm?: boolean;
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

function normalizeVehicleInput(input: BookingVehicleInput | null | undefined) {
  const make = clean(input?.make);
  const model = clean(input?.model);
  if (!make || !model) {
    throw new BookingError("Укажите марку и модель автомобиля", "booking_vehicle_required");
  }
  return {
    make,
    model,
    generation: clean(input?.generation),
    year: normalizeYear(input?.year),
    plate: clean(input?.plate)?.toUpperCase() ?? null,
    vin: clean(input?.vin)?.toUpperCase() ?? null,
  };
}

async function findPublicIdempotentBooking(branchId: string, auditId: string) {
  const audit = await prisma.branchAuditLog.findFirst({
    where: { id: auditId, branchId },
    select: { branchId: true, action: true, entityType: true, entityId: true },
  });
  if (audit?.branchId !== branchId || audit.action !== "booking.created" || audit.entityType !== "booking" || !audit.entityId) {
    return null;
  }
  return prisma.booking.findFirst({
    where: { id: audit.entityId, branchId },
    include: BOOKING_INCLUDE,
  });
}

export async function getPublicBookingByIdempotency(branchId: string, idempotencyKey: string) {
  if (!branchId) throw new BookingError("Филиал не указан", "booking_branch_required");
  const auditId = publicBookingIdempotencyAuditId(branchId, idempotencyKey);
  const booking = await findPublicIdempotentBooking(branchId, auditId);
  if (!booking) {
    throw new BookingError("Результат операции пока не найден", "booking_idempotency_result_not_found", 404);
  }
  return {
    booking,
    managementToken: createManagementToken(booking.managementHandle, booking.managementTokenVersion),
  };
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
  overrideReason?: BookingOverrideReason | null,
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
  if (exact) return null;

  const endsAt = new Date(input.startsAt.getTime() + availability.durationMinutes * 60_000);
  const overlaps = await tx.booking.count({
    where: {
      branchId: input.branchId,
      masterMembershipId: input.masterMembershipId,
      status: BOOKING_STATUS.ACTIVE,
      startsAt: { lt: endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
    },
  });
  const localTime = formatLocalTime(input.startsAt, branch.timezone);
  const actualReason: BookingOverrideReason = overlaps > 0
    ? "slot_taken"
    : localTimeToMinutes(localTime) % availability.stepMinutes !== 0
      ? "nonstandard_start"
      : "outside_schedule";
  const message = actualReason === "slot_taken"
    ? "На выбранное время уже есть запись"
    : actualReason === "nonstandard_start"
      ? `Начало записи выбирается с шагом ${availability.stepMinutes} минут`
      : availability.message ?? `Работа не помещается в график мастера (${availability.durationMinutes} минут)`;
  if (overrideReason !== actualReason) {
    throw new BookingError(message, `booking_${actualReason}`, 409, {
      reasonCode: actualReason,
      alternatives: availability.slots.slice(0, 3),
    });
  }
  return actualReason;
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
  if (!isValidBookingCustomerName(customerName)) {
    throw new BookingError("Укажите, как к вам обращаться", "booking_customer_name_required");
  }
  if (!normalizedPhone) throw new BookingError("Укажите корректный телефон", "booking_phone_invalid");
  if (!input.branchId) throw new BookingError("Филиал не указан", "booking_branch_required");
  if (!input.masterMembershipId) throw new BookingError("Мастер не выбран", "booking_master_required");
  const publicAuditId = actor.kind === "PUBLIC"
    ? publicBookingIdempotencyAuditId(input.branchId, input.idempotencyKey)
    : null;
  if (publicAuditId) {
    const existing = await findPublicIdempotentBooking(input.branchId, publicAuditId);
    if (existing) {
      return {
        booking: existing,
        managementToken: createManagementToken(existing.managementHandle, existing.managementTokenVersion),
        reused: true,
      };
    }
  }
  const startsAt = dateValue(input.startsAt, "startsAt");
  const overrideReason = input.overrideReason ?? (input.overrideConflict ? "slot_taken" : null);
  const wantsOverride = Boolean(overrideReason);
  if (wantsOverride && !actor.allowConflictOverride) {
    throw new BookingError("Нет права создавать пересекающиеся записи", "booking_override_forbidden", 403);
  }
  // Validate the signing configuration before any durable write. A booking
  // must never commit and then fail while its management link is generated.
  const managementHandle = createManagementHandle();
  const managementToken = createManagementToken(managementHandle, 1);

  let created;
  try {
    created = await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
    await lockKeys(tx, [`booking-master:${input.branchId}:${input.masterMembershipId}`]);
    const onlineOnly = actor.kind === "PUBLIC";
    const loaded = await loadServices(tx, input.branchId, input.serviceIds, onlineOnly);
    const { services, ids } = loaded;
    const durationMinutes = actor.kind !== "PUBLIC" && actor.kind !== "MANAGE_LINK" && input.durationOverrideMinutes && input.durationOverrideMinutes >= 5
      ? Math.min(Math.trunc(input.durationOverrideMinutes), 1_440)
      : loaded.durationMinutes;
    if (durationMinutes <= 0) throw new BookingError("У услуг не настроена длительность", "booking_duration_invalid", 409);
    await assertMasterAssignments(tx, input.branchId, input.masterMembershipId, ids);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const appliedOverrideReason = await assertAvailableSlot(tx, {
        branchId: input.branchId,
        serviceIds: ids,
        masterMembershipId: input.masterMembershipId,
        startsAt,
        onlineOnly,
        respectLeadTime: actor.respectLeadTime !== false,
        durationOverrideMinutes: durationMinutes,
      }, overrideReason);
    await assertNoOverlap(tx, {
      branchId: input.branchId,
      masterMembershipId: input.masterMembershipId,
      startsAt,
      endsAt,
    }, appliedOverrideReason === "slot_taken");
    const requiredFields = requiredServiceFields(services);
    const requiresVin = requiredFields.has("vin");
    const needsVehicleClarification = actor.kind === "PUBLIC" && requiresVin && input.needsVehicleClarification === true;
    const submittedVehicle = !input.vehicleId ? normalizeVehicleInput(input.vehicle) : null;
    const vehicleVin = submittedVehicle?.vin ?? null;
    if (requiresVin && !needsVehicleClarification && !vehicleVin && !input.vehicleId) {
      throw new BookingError("Для выбранной услуги нужен VIN", "booking_vin_required");
    }

    const client = await inBookingCreatePhase("client", () => resolveClient(tx, input, normalizedPhone));
    // A public form submission is a snapshot for this booking, not permission
    // to select or mutate a vehicle in somebody else's canonical CRM profile.
    const vehicle = actor.kind === "PUBLIC"
      ? null
      : await inBookingCreatePhase("vehicle", () => resolveVehicle(tx, input, client.id));
    // When a plate/VIN matches an older profile, keep the association but use
    // the values submitted for this visit in its immutable booking snapshot.
    // Canonical vehicle data can be reviewed separately by an authorised user.
    const bookingVehicle = submittedVehicle ?? vehicle;
    if (!bookingVehicle) {
      throw new BookingError("Укажите автомобиль", "booking_vehicle_required");
    }
    if (requiresVin && !needsVehicleClarification && !bookingVehicle.vin) {
      throw new BookingError("Для выбранной услуги нужен VIN", "booking_vin_required");
    }
    if (requiredFields.has("email") && !clean(input.email)) {
      throw new BookingError("Для выбранной услуги нужен email", "booking_email_required");
    }
    if (requiredFields.has("plate") && !bookingVehicle.plate) {
      throw new BookingError("Для выбранной услуги нужен госномер", "booking_plate_required");
    }
    if (requiredFields.has("year") && !bookingVehicle.year) {
      throw new BookingError("Для выбранной услуги нужен год автомобиля", "booking_vehicle_year_required");
    }
    const requiresConfirmation = services.some((service) => service.requiresConfirmation) || needsVehicleClarification;
    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) throw new BookingError("Филиал не найден", "booking_branch_not_found", 404);

    const bookingRow = await inBookingCreatePhase("booking", () => tx.booking.create({
      data: {
        branchId: input.branchId,
        clientId: client.id,
        vehicleId: vehicle?.id ?? null,
        masterMembershipId: input.masterMembershipId,
        customerName,
        phone: input.phone.trim(),
        normalizedPhone,
        email: clean(input.email),
        vehicleSnapshot: {
          make: bookingVehicle.make,
          model: bookingVehicle.model,
          generation: bookingVehicle.generation,
          year: bookingVehicle.year,
          plate: bookingVehicle.plate,
          vin: bookingVehicle.vin,
        },
        vin: bookingVehicle.vin,
        startsAt,
        endsAt,
        durationMinutes,
        source: input.source ?? (actor.kind === "PUBLIC" ? BOOKING_SOURCE.PUBLIC : BOOKING_SOURCE.ADMIN),
        requiresConfirmation,
        confirmationState: requiresConfirmation ? BOOKING_CONFIRMATION.PENDING : BOOKING_CONFIRMATION.NOT_REQUIRED,
        comment: clean(input.comment),
        internalComment: actor.kind === "USER"
          ? clean(input.internalComment)
          : needsVehicleClarification
            ? BOOKING_VEHICLE_CLARIFICATION_MARKER
            : null,
        conflictOverride: Boolean(appliedOverrideReason),
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
        ...(publicAuditId ? { id: publicAuditId } : {}),
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
          overrideReason: appliedOverrideReason,
          serviceIds: ids,
          conflictOverride: booking.conflictOverride,
        },
      },
    }));
    return booking;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    // If the response or the concurrent transaction was lost after commit,
    // resolve the original operation instead of creating a second booking.
    if (publicAuditId) {
      const existing = await findPublicIdempotentBooking(input.branchId, publicAuditId);
      if (existing) {
        return {
          booking: existing,
          managementToken: createManagementToken(existing.managementHandle, existing.managementTokenVersion),
          reused: true,
        };
      }
    }
    throw error;
  }

  return {
    booking: created,
    managementToken,
    reused: false,
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
  const overrideReason = input.overrideReason ?? (input.overrideConflict ? "slot_taken" : null);
  const wantsOverride = Boolean(overrideReason);
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
    if (durationMinutes <= 0) throw new BookingError("У услуг не настроена длительность", "booking_duration_invalid", 409);
    await assertMasterAssignments(tx, current.branchId, masterMembershipId, ids);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const appliedOverrideReason = await assertAvailableSlot(tx, {
        branchId: current.branchId,
        serviceIds: ids,
        masterMembershipId,
        startsAt,
        onlineOnly,
        respectLeadTime: actor.respectLeadTime !== false,
        excludeBookingId: current.id,
        durationOverrideMinutes: durationMinutes,
      }, overrideReason);
    await assertNoOverlap(tx, {
      branchId: current.branchId,
      masterMembershipId,
      startsAt,
      endsAt,
      excludeBookingId: current.id,
    }, appliedOverrideReason === "slot_taken");

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
        conflictOverride: Boolean(appliedOverrideReason),
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
          overrideReason: appliedOverrideReason,
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

/** Journal edit transaction: schedule, client, vehicle, services and confirmation commit together. */
export async function updateBooking(bookingId: string, input: UpdateBookingInput, actor: BookingActor) {
  const overrideReason = input.overrideReason ?? (input.overrideConflict ? "slot_taken" : null);
  const wantsOverride = Boolean(overrideReason);
  if (wantsOverride && !actor.allowConflictOverride) {
    throw new BookingError("Нет права сохранять запись с конфликтом", "booking_override_forbidden", 403);
  }
  return (prisma as unknown as PrismaClient).$transaction(async (tx) => {
    await lockKeys(tx, [`booking:${bookingId}`]);
    const current = await tx.booking.findFirst({ where: { id: bookingId }, include: BOOKING_INCLUDE });
    if (!current) throw new BookingError("Запись не найдена", "booking_not_found", 404);
    if (current.status !== BOOKING_STATUS.ACTIVE) throw new BookingError("Отменённую запись нельзя изменить", "booking_cancelled", 409);

    const startsAt = input.startsAt ? dateValue(input.startsAt, "startsAt") : current.startsAt;
    const masterMembershipId = input.masterMembershipId ?? current.masterMembershipId;
    if (!masterMembershipId) throw new BookingError("Мастер не выбран", "booking_master_required");
    await lockKeys(tx, [
      `booking-master:${current.branchId}:${masterMembershipId}`,
      ...(current.masterMembershipId ? [`booking-master:${current.branchId}:${current.masterMembershipId}`] : []),
    ]);
    const serviceIds = input.serviceIds?.length
      ? input.serviceIds
      : current.serviceItems.map((item) => item.serviceId).filter((id): id is string => Boolean(id));
    const loaded = await loadServices(tx, current.branchId, serviceIds, false);
    const durationMinutes = input.durationOverrideMinutes && input.durationOverrideMinutes >= 5
      ? Math.min(Math.trunc(input.durationOverrideMinutes), 1_440)
      : loaded.durationMinutes;
    if (durationMinutes <= 0) throw new BookingError("У услуг не настроена длительность", "booking_duration_invalid", 409);
    await assertMasterAssignments(tx, current.branchId, masterMembershipId, loaded.ids);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const currentServiceIds = current.serviceItems.map((item) => item.serviceId).filter((id): id is string => Boolean(id)).sort();
    const scheduleChanged = startsAt.getTime() !== current.startsAt.getTime()
      || masterMembershipId !== current.masterMembershipId
      || durationMinutes !== current.durationMinutes
      || loaded.ids.slice().sort().join("|") !== currentServiceIds.join("|");
    let appliedOverrideReason: BookingOverrideReason | null = null;
    if (scheduleChanged) {
      appliedOverrideReason = await assertAvailableSlot(tx, {
          branchId: current.branchId,
          serviceIds: loaded.ids,
          masterMembershipId,
          startsAt,
          onlineOnly: false,
          respectLeadTime: false,
          excludeBookingId: current.id,
          durationOverrideMinutes: durationMinutes,
        }, overrideReason);
      await assertNoOverlap(tx, {
        branchId: current.branchId,
        masterMembershipId,
        startsAt,
        endsAt,
        excludeBookingId: current.id,
      }, appliedOverrideReason === "slot_taken");
    }

    const customerName = clean(input.customerName) ?? current.customerName;
    const phone = clean(input.phone) ?? current.phone;
    const normalizedPhone = normalizePhoneKey(phone);
    if (!normalizedPhone) throw new BookingError("Укажите корректный телефон", "booking_phone_invalid");
    const clientInput: CreateBookingInput = {
      branchId: current.branchId,
      serviceIds: loaded.ids,
      masterMembershipId,
      startsAt,
      customerName,
      phone,
      email: input.email === undefined ? current.email : input.email,
      clientId: input.clientId === undefined ? current.clientId : input.clientId,
      vehicleId: input.vehicleId === undefined ? current.vehicleId : input.vehicleId,
      vehicle: input.vehicle,
    };
    const client = await resolveClient(tx, clientInput, normalizedPhone);
    let vehicle = current.vehicle;
    if (clientInput.vehicleId || input.vehicle) {
      vehicle = await resolveVehicle(tx, clientInput, client.id);
      if (vehicle && input.vehicle && clientInput.vehicleId) {
        vehicle = await tx.clientVehicle.update({
          where: { branchId_id: { branchId: current.branchId, id: vehicle.id } },
          data: {
            make: clean(input.vehicle.make) ?? vehicle.make,
            model: clean(input.vehicle.model) ?? vehicle.model,
            generation: input.vehicle.generation === undefined ? undefined : clean(input.vehicle.generation),
            year: input.vehicle.year === undefined ? undefined : normalizeYear(input.vehicle.year),
            plate: input.vehicle.plate === undefined ? undefined : clean(input.vehicle.plate)?.toUpperCase() ?? null,
            vin: input.vehicle.vin === undefined ? undefined : clean(input.vehicle.vin)?.toUpperCase() ?? null,
          },
        });
      }
    }
    if (!vehicle || vehicle.counterpartyId !== client.id) {
      throw new BookingError("Выберите автомобиль клиента", "booking_vehicle_required");
    }
    const requiredFields = requiredServiceFields(loaded.services);
    const nextEmail = input.email === undefined ? current.email : clean(input.email);
    if (loaded.services.some((service) => service.requiresVin) && !vehicle.vin) throw new BookingError("Для выбранной услуги нужен VIN", "booking_vin_required");
    if (requiredFields.has("email") && !nextEmail) throw new BookingError("Для выбранной услуги нужен email", "booking_email_required");
    if (requiredFields.has("plate") && !vehicle.plate) throw new BookingError("Для выбранной услуги нужен госномер", "booking_plate_required");
    if (requiredFields.has("year") && !vehicle.year) throw new BookingError("Для выбранной услуги нужен год автомобиля", "booking_vehicle_year_required");

    await tx.localCounterparty.update({
      where: { branchId_id: { branchId: current.branchId, id: client.id } },
      data: { name: customerName, displayName: customerName, phone, normalizedPhone, email: nextEmail },
    });
    if (loaded.ids.slice().sort().join("|") !== currentServiceIds.join("|")) {
      await tx.bookingServiceItem.deleteMany({ where: { branchId: current.branchId, bookingId: current.id } });
      await tx.bookingServiceItem.createMany({
        data: loaded.services.map((service, index) => ({
          branchId: current.branchId,
          bookingId: current.id,
          serviceId: service.id,
          serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
          sortOrder: index,
        })),
      });
    }
    const requiresConfirmation = loaded.services.some((service) => service.requiresConfirmation);
    const shouldConfirm = input.confirm === true && requiresConfirmation;
    const booking = await tx.booking.update({
      where: { branchId_id: { branchId: current.branchId, id: current.id } },
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        masterMembershipId,
        customerName,
        phone,
        normalizedPhone,
        email: nextEmail,
        vehicleSnapshot: { make: vehicle.make, model: vehicle.model, generation: vehicle.generation, year: vehicle.year, plate: vehicle.plate, vin: vehicle.vin },
        vin: vehicle.vin,
        startsAt,
        endsAt,
        durationMinutes,
        requiresConfirmation,
        confirmationState: shouldConfirm ? BOOKING_CONFIRMATION.CONFIRMED : scheduleChanged && requiresConfirmation ? BOOKING_CONFIRMATION.PENDING : requiresConfirmation ? current.confirmationState : BOOKING_CONFIRMATION.NOT_REQUIRED,
        confirmedAt: shouldConfirm ? new Date() : scheduleChanged ? null : undefined,
        confirmedBy: shouldConfirm ? actor.userId ?? actor.kind : scheduleChanged ? null : undefined,
        comment: input.comment === undefined ? undefined : clean(input.comment),
        internalComment: input.internalComment === undefined ? undefined : clean(input.internalComment),
        conflictOverride: Boolean(appliedOverrideReason),
      },
      include: BOOKING_INCLUDE,
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: current.branch.businessGroupId,
        branchId: current.branchId,
        userId: actor.userId ?? null,
        action: scheduleChanged ? "booking.updated_and_rescheduled" : "booking.updated",
        entityType: "booking",
        entityId: current.id,
        metadata: {
          actor: actor.kind,
          scheduleChanged,
          previousStartsAt: current.startsAt.toISOString(),
          startsAt: booking.startsAt.toISOString(),
          previousEndsAt: current.endsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
          masterMembershipId,
          serviceIds: loaded.ids,
          conflictOverride: wantsOverride,
          overrideReason: appliedOverrideReason,
          confirmed: shouldConfirm,
        },
      },
    });
    return { booking, scheduleChanged, confirmed: shouldConfirm && current.confirmationState !== BOOKING_CONFIRMATION.CONFIRMED };
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
