import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { getYclientsBranchConfig } from "@/lib/yclients/branch-config";
import { BOOKING_CONFIRMATION, BOOKING_SOURCE, BOOKING_STATUS } from "./constants";
import { BookingError } from "./errors";
import { createManagementHandle } from "./management-token";
import { assertLocalDate, zonedLocalToUtc } from "./timezone";

type JsonObject = Record<string, unknown>;

const PROVIDER = "yclients-booking-history";

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ");
}

function remoteRecordId(record: JsonObject) {
  return String(record.id ?? record.record_id ?? "").trim();
}

function remoteStartsAt(record: JsonObject, timezone: string) {
  const raw = text(record.datetime) ?? text(record.date);
  if (!raw) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/u.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/u);
  if (match) return zonedLocalToUtc(match[1], match[2], timezone);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function remoteClient(record: JsonObject) {
  const client = object(record.client);
  return {
    name: text(client.display_name) ?? text(client.name) ?? text(record.name) ?? "Клиент Yclients",
    phone: text(client.phone) ?? text(record.phone) ?? "",
    email: text(client.email) ?? text(record.email),
  };
}

function remoteVehicle(record: JsonObject) {
  const client = object(record.client);
  const candidate = [record.vehicle, record.car, record.auto, client.vehicle, client.car].map(object).find((item) => Object.keys(item).length) ?? {};
  const display = text(candidate.model) ?? text(candidate.title) ?? text(candidate.name) ?? text(record.vehicle_model) ?? "";
  const words = display.split(/\s+/u).filter(Boolean);
  const make = text(candidate.make) ?? text(candidate.brand) ?? words[0] ?? null;
  const model = text(candidate.model) ?? (words.slice(1).join(" ") || null);
  const year = positiveInt(candidate.year ?? record.vehicle_year, 0) || null;
  const plate = (text(candidate.plate) ?? text(candidate.number) ?? text(record.vehicle_plate))?.toUpperCase() ?? null;
  const vin = (text(candidate.vin) ?? text(candidate.VIN) ?? text(record.vehicle_vin))?.toUpperCase() ?? null;
  return { make, model, year, plate, vin };
}

function remoteServices(record: JsonObject) {
  const services = Array.isArray(record.services) ? record.services : [];
  return services.map((value, index) => {
    const service = object(value);
    return {
      externalId: String(service.id ?? index),
      name: text(service.title) ?? text(service.name) ?? `Услуга ${index + 1}`,
      durationMinutes: Math.max(5, Math.round(positiveInt(service.seance_length ?? service.duration, 0) / 60) || 5),
    };
  });
}

function remoteMasterName(record: JsonObject) {
  const staff = object(record.staff);
  return text(staff.name) ?? text(record.staff_name) ?? null;
}

function cancelled(record: JsonObject) {
  const status = String(record.status ?? record.state ?? "").toLowerCase();
  return /cancel|delete|отмен/u.test(status) || record.deleted === true;
}

async function authHeader() {
  const config = await getYclientsBranchConfig();
  if (config.userToken) return { config, header: `Bearer ${config.partnerToken}, User ${config.userToken}` };
  if (!config.userLogin || !config.userPassword) {
    throw new BookingError("Для импорта нужен userToken или логин/пароль Yclients", "booking_legacy_auth_missing", 409);
  }
  const response = await fetch(`${config.apiBase}/auth`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.partnerToken}`,
      Accept: "application/vnd.yclients.v2+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ login: config.userLogin, password: config.userPassword }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as JsonObject | null;
  const token = text(body?.user_token) ?? text(object(body?.data).user_token);
  if (!response.ok || !token) throw new BookingError("Yclients не подтвердил доступ к архиву", "booking_legacy_auth_failed", 424);
  return { config, header: `Bearer ${config.partnerToken}, User ${token}` };
}

async function fetchRecords(input: { fromDate: string; toDate: string; startPage?: number; onPage: (page: number, rows: JsonObject[]) => Promise<void> }) {
  const { config, header } = await authHeader();
  let page = Math.max(1, input.startPage ?? 1);
  const count = 200;
  while (page <= 1_000) {
    const params = new URLSearchParams({ start_date: input.fromDate, end_date: input.toDate, page: String(page), count: String(count) });
    const response = await fetch(`${config.apiBase}/records/${config.companyId}?${params}`, {
      headers: { Authorization: header, Accept: "application/vnd.yclients.v2+json" },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as JsonObject | null;
    if (!response.ok) {
      throw new BookingError(text(body?.error) ?? text(object(body?.meta).message) ?? "Не удалось прочитать архив Yclients", "booking_legacy_fetch_failed", 424);
    }
    const rows = Array.isArray(body?.data) ? body.data.map(object) : [];
    await input.onPage(page, rows);
    if (rows.length < count) break;
    page += 1;
  }
}

async function importRecord(
  tx: Prisma.TransactionClient,
  input: { branchId: string; timezone: string; record: JsonObject; membershipByName: Map<string, string> },
) {
  const legacyExternalId = remoteRecordId(input.record);
  if (!legacyExternalId) return "invalid" as const;
  const existing = await tx.booking.findUnique({ where: { branchId_legacyExternalId: { branchId: input.branchId, legacyExternalId } }, select: { id: true } });
  if (existing) return "skipped" as const;
  const startsAt = remoteStartsAt(input.record, input.timezone);
  if (!startsAt) return "invalid" as const;
  const clientData = remoteClient(input.record);
  const normalizedPhone = normalizePhoneKey(clientData.phone);
  let client = normalizedPhone
    ? await tx.localCounterparty.findFirst({ where: { branchId: input.branchId, normalizedPhone, archived: false }, orderBy: { updatedAt: "desc" } })
    : null;
  if (!client && normalizedPhone) {
    client = await tx.localCounterparty.create({
      data: {
        branchId: input.branchId,
        name: clientData.name,
        displayName: clientData.name,
        category: "INDIVIDUAL",
        status: "ACTIVE",
        phone: clientData.phone,
        email: clientData.email,
        normalizedPhone,
        phonesRaw: [clientData.phone],
        companyType: "individual",
        counterpartyTypeName: "Физическое лицо",
        searchText: [clientData.name, clientData.phone, normalizedPhone].filter(Boolean).join(" ").toLowerCase(),
        raw: { source: "LEGACY_YCLIENTS", externalId: legacyExternalId },
        syncedAt: new Date(),
      },
    });
  }
  const vehicleData = remoteVehicle(input.record);
  let vehicle = null;
  if (client && vehicleData.make && vehicleData.model) {
    const vehicleCreateData = { ...vehicleData, make: vehicleData.make, model: vehicleData.model };
    vehicle = vehicleData.vin || vehicleData.plate
      ? await tx.clientVehicle.findFirst({
          where: {
            branchId: input.branchId,
            counterpartyId: client.id,
            OR: [vehicleData.vin ? { vin: vehicleData.vin } : null, vehicleData.plate ? { plate: vehicleData.plate } : null].filter((value): value is { vin: string } | { plate: string } => Boolean(value)),
          },
        })
      : null;
    vehicle ??= await tx.clientVehicle.create({ data: { branchId: input.branchId, counterpartyId: client.id, ...vehicleCreateData } });
  }
  const services = remoteServices(input.record);
  const durationMinutes = Math.max(
    5,
    Math.round(positiveInt(input.record.seance_length ?? input.record.length, 0) / 60)
      || services.reduce((total, service) => total + service.durationMinutes, 0)
      || 40,
  );
  const masterName = remoteMasterName(input.record);
  const masterMembershipId = masterName ? input.membershipByName.get(normalizeName(masterName)) ?? null : null;
  const isCancelled = cancelled(input.record);
  await tx.booking.create({
    data: {
      branchId: input.branchId,
      clientId: client?.id ?? null,
      vehicleId: vehicle?.id ?? null,
      masterMembershipId,
      customerName: clientData.name,
      phone: clientData.phone || "Не указан",
      normalizedPhone: normalizedPhone ?? `legacy:${legacyExternalId}`,
      email: clientData.email,
      vehicleSnapshot: vehicleData as Prisma.InputJsonValue,
      vin: vehicleData.vin,
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
      durationMinutes,
      source: BOOKING_SOURCE.LEGACY_YCLIENTS,
      status: isCancelled ? BOOKING_STATUS.CANCELLED : BOOKING_STATUS.ACTIVE,
      requiresConfirmation: false,
      confirmationState: BOOKING_CONFIRMATION.NOT_REQUIRED,
      comment: text(input.record.comment),
      internalComment: masterName && !masterMembershipId ? `Архивный сотрудник Yclients: ${masterName}` : null,
      conflictOverride: false,
      managementHandle: createManagementHandle(),
      legacyExternalId,
      cancelledAt: isCancelled ? new Date() : null,
      cancelledBy: isCancelled ? "LEGACY_YCLIENTS" : null,
      serviceItems: {
        create: (services.length ? services : [{ externalId: "unknown", name: "Услуга Yclients", durationMinutes }]).map((service, index) => ({
          branchId: input.branchId,
          serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
          sortOrder: index,
        })),
      },
    },
  });
  return "imported" as const;
}

export async function getLegacyBookingImportStatus(branchId: string) {
  return prisma.branchIntegrationMigration.findUnique({ where: { branchId_provider: { branchId, provider: PROVIDER } } });
}

export async function importLegacyYclientsBookings(input: {
  branchId: string;
  businessGroupId: string;
  userId: string;
  fromDate: string;
  toDate: string;
}) {
  assertLocalDate(input.fromDate);
  assertLocalDate(input.toDate);
  if (input.fromDate > input.toDate) throw new BookingError("Начальная дата позже конечной", "booking_legacy_range_invalid");
  const branch = await prisma.branch.findUnique({ where: { id: input.branchId }, select: { timezone: true, legacyOrganizationId: true } });
  if (!branch) throw new BookingError("Филиал не найден", "booking_branch_not_found", 404);
  const previousMigration = await prisma.branchIntegrationMigration.findUnique({
    where: { branchId_provider: { branchId: input.branchId, provider: PROVIDER } },
  });
  const previousMetadata = object(previousMigration?.metadataJson);
  const sameRange = text(previousMetadata.fromDate) === input.fromDate && text(previousMetadata.toDate) === input.toDate;
  const previousTotals = {
    imported: positiveInt(previousMetadata.imported, 0),
    skipped: positiveInt(previousMetadata.skipped, 0),
    invalid: positiveInt(previousMetadata.invalid, 0),
    pages: positiveInt(previousMetadata.pages ?? previousMetadata.lastPage, 0),
  };
  if (previousMigration?.status === "COMPLETED" && sameRange) return previousTotals;
  const resume = sameRange && ["IN_PROGRESS", "FAILED"].includes(previousMigration?.status ?? "");
  const startPage = resume ? previousTotals.pages + 1 : 1;
  const totals = resume ? previousTotals : { imported: 0, skipped: 0, invalid: 0, pages: 0 };
  await prisma.branchIntegrationMigration.upsert({
    where: { branchId_provider: { branchId: input.branchId, provider: PROVIDER } },
    create: { branchId: input.branchId, organizationId: branch.legacyOrganizationId ?? input.branchId, provider: PROVIDER, source: "yclients_api", status: "IN_PROGRESS", metadataJson: { fromDate: input.fromDate, toDate: input.toDate, imported: 0, skipped: 0, invalid: 0 } },
    update: { status: "IN_PROGRESS", lastErrorCode: null, metadataJson: { fromDate: input.fromDate, toDate: input.toDate, ...totals, lastPage: totals.pages } },
  });
  const memberships = await prisma.branchMembership.findMany({ where: { branchId: input.branchId }, include: { user: { select: { name: true } } } });
  const membershipByName = new Map(memberships.map((membership) => [normalizeName(membership.user.name), membership.id]));
  try {
    await fetchRecords({
      fromDate: input.fromDate,
      toDate: input.toDate,
      startPage,
      onPage: async (page, rows) => {
        for (const record of rows) {
          try {
            const outcome = await (prisma as unknown as PrismaClient).$transaction((tx) => importRecord(tx, { branchId: input.branchId, timezone: branch.timezone, record, membershipByName }));
            totals[outcome] += 1;
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") totals.skipped += 1;
            else totals.invalid += 1;
          }
        }
        totals.pages = page;
        await prisma.branchIntegrationMigration.update({
          where: { branchId_provider: { branchId: input.branchId, provider: PROVIDER } },
          data: { metadataJson: { fromDate: input.fromDate, toDate: input.toDate, ...totals, lastPage: page } },
        });
      },
    });
    await prisma.branchIntegrationMigration.update({
      where: { branchId_provider: { branchId: input.branchId, provider: PROVIDER } },
      data: { status: "COMPLETED", migratedAt: new Date(), metadataJson: { fromDate: input.fromDate, toDate: input.toDate, ...totals } },
    });
    await prisma.branchAuditLog.create({
      data: {
        businessGroupId: input.businessGroupId,
        branchId: input.branchId,
        userId: input.userId,
        action: "booking.legacy_yclients_imported",
        entityType: "branch_integration_migration",
        entityId: input.branchId,
        metadata: { fromDate: input.fromDate, toDate: input.toDate, ...totals },
      },
    });
    return totals;
  } catch (error) {
    await prisma.branchIntegrationMigration.update({
      where: { branchId_provider: { branchId: input.branchId, provider: PROVIDER } },
      data: { status: "FAILED", lastErrorCode: error instanceof BookingError ? error.code : "booking_legacy_import_failed", metadataJson: { fromDate: input.fromDate, toDate: input.toDate, ...totals } },
    });
    throw error;
  }
}
