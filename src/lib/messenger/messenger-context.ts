import crypto from "crypto";
import { Prisma, type LocalCounterparty } from "@prisma/client";
import {
  anonymousRetailCounterpartyExclusion,
  isAnonymousRetailCounterparty,
} from "@/lib/anonymous-retail-counterparty";
import { clientCaseStatusLabel, defaultNextActionForCaseStatus } from "@/lib/client-case-shared";
import { getFirstCrmStage } from "@/lib/crm";
import { getBookingAvailability } from "@/lib/booking/availability";
import { BookingError } from "@/lib/booking/errors";
import { notifyBookingCreated } from "@/lib/booking/notifications";
import { BOOKING_INCLUDE, createBooking, type BookingWithDetails } from "@/lib/booking/service";
import { formatLocalDate, formatLocalTime, zonedLocalToUtc } from "@/lib/booking/timezone";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { type CreateDemandBody } from "@/lib/demand-create-payload";
import { buildDiagnosticReportMessage } from "@/lib/diagnostic-report-message";
import { syncDiagnosticVehicleFromShipment } from "@/lib/diagnostic-vehicle-sync";
import { createLocalDemand } from "@/lib/local-demand-write";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationId } from "./messenger-tenant";
import { listMessages, sendMessage } from "./messenger-gateway";
import type { Conversation, MessengerChannel, SendMessageInput } from "./messenger-types";

export type MessengerContextState =
  | "unclassified"
  | "suggestions"
  | "unlinked"
  | "linked"
  | "conflict"
  | "archived"
  | "supplier"
  | "employee"
  | "group"
  | "forbidden"
  | "error";

function bookingForMessenger(booking: BookingWithDetails) {
  return {
    id: booking.id,
    slot: {
      date: formatLocalDate(booking.startsAt, booking.branch.timezone),
      time: formatLocalTime(booking.startsAt, booking.branch.timezone),
    },
    comment: booking.serviceItems.map((item) => item.serviceNameSnapshot).join(", ") || booking.comment || "Обслуживание",
    vin: booking.vehicle?.vin ?? "",
    status: booking.status,
  };
}

async function loadRelatedBooking(bookingId: string | null | undefined) {
  if (!bookingId) return null;
  return prisma.booking.findFirst({
    where: { id: bookingId, branchId: contextBranchId() },
    include: BOOKING_INCLUDE,
  });
}

type ConversationContextRow = {
  id: string;
  organizationId: string;
  messengerAccountId: string | null;
  channel: MessengerChannel;
  externalConversationId: string;
  externalChatId: string | null;
  externalUserId: string | null;
  participantName: string;
  participantUsername: string | null;
  participantPhone: string | null;
  title: string;
  status: string;
  clientId: string | null;
  employeeId: string | null;
  supplierId: string | null;
  relatedCaseId: string | null;
  relatedAppointmentId: string | null;
  relatedShipmentId: string | null;
  relatedDiagnosticId: string | null;
  assignedToId: string | null;
  updatedAt: Date;
  metadataJson: Record<string, unknown> | null;
};

type ContextActor = {
  id?: string | null;
  login?: string | null;
  role?: string | null;
};

export type MessengerContextVehicle = {
  id: string;
  label: string;
  plate: string;
  vin: string;
  year?: string | null;
};

export type MessengerContextClient = {
  id: string;
  name: string;
  phone: string;
  type: "Физлицо" | "Юрлицо" | "Поставщик";
  telegramUsername?: string | null;
  vehicle?: MessengerContextVehicle;
  vehicles: MessengerContextVehicle[];
  activeCase?: {
    id: string;
    title: string;
    status: string;
    responsible: string;
    deadline: string;
    overdue?: boolean;
  };
  appointment?: {
    id: string;
    date: string;
    service: string;
    status: string;
  };
  shipments: Array<{
    id: string;
    title: string;
    amount: string;
    status: string;
  }>;
  diagnostics: Array<{
    id: string;
    title: string;
    status: string;
    publicReportUrl?: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
  }>;
};

export type MessengerClientSuggestion = {
  id: string;
  name: string;
  phone: string;
  type: MessengerContextClient["type"];
  score: number;
  reason: string;
  vehicle?: MessengerContextVehicle;
};

export type MessengerContextAction = {
  key: string;
  label: string;
  enabled: boolean;
  reason?: string;
  href?: string;
};

export type MessengerConversationContext = {
  state: MessengerContextState;
  reason?: string;
  conversationId: string;
  organizationId: string;
  expectedUpdatedAt: string;
  identity?: {
    status: string;
    entityType: string;
    clientId?: string | null;
    conflictClientId?: string | null;
  } | null;
  client: MessengerContextClient | null;
  suggestions: MessengerClientSuggestion[];
  selectedVehicle: MessengerContextVehicle | null;
  vehicles: MessengerContextVehicle[];
  actions: MessengerContextAction[];
  updatedAt: string;
};

export class MessengerContextError extends Error {
  constructor(
    message: string,
    readonly status = 500
  ) {
    super(message);
  }
}

type DbRunner = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

const VEHICLE_LINK_TYPE = "VEHICLE";
const CLIENT_LINK_TYPE = "CLIENT";
const CASE_LINK_TYPE = "CLIENT_CASE";
const APPOINTMENT_LINK_TYPE = "APPOINTMENT";
const SHIPMENT_LINK_TYPE = "SHIPMENT";
const TASK_LINK_TYPE = "TASK";

function contextBranchId() {
  return getScopedBranchId();
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function cleanOptional(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function actorId(actor?: ContextActor | null) {
  return actor?.id || actor?.login || null;
}

function assertOwnerOrAdmin(actor?: ContextActor | null) {
  if (!actor) throw new MessengerContextError("Необходима авторизация", 401);
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new MessengerContextError("Недостаточно прав для изменения контекста диалога", 403);
  }
}

function formatMoney(cents?: number | null) {
  const value = Number(cents ?? 0) / 100;
  return value > 0 ? `${value.toLocaleString("ru-RU")} ₽` : "без суммы";
}

function localMeta(type: string, id: string, href?: string | null) {
  return {
    href: href || `local://${type}/${id}`,
    type,
    mediaType: "application/json",
  };
}

function counterpartyType(counterparty: LocalCounterparty): MessengerContextClient["type"] {
  const raw = jsonRecord(counterparty.raw);
  const value = cleanText(raw.type || raw.companyType || raw.counterpartyType).toLowerCase();
  if (value.includes("постав") || value === "supplier") return "Поставщик";
  if (counterparty.inn || value.includes("юр") || value.includes("company")) return "Юрлицо";
  return "Физлицо";
}

function vehicleFromRaw(clientId: string, raw: unknown): MessengerContextVehicle | null {
  const record = jsonRecord(raw);
  const vehicle = jsonRecord(record.vehicle || record.car || record.auto);
  const source = Object.keys(vehicle).length > 0 ? vehicle : record;
  const brand = cleanText(source.brand || source.make || source.mark);
  const model = cleanText(source.model || source.name);
  const label = cleanText(source.label) || [brand, model].filter(Boolean).join(" ").trim();
  const plate = cleanText(source.plate || source.licensePlate || source.gosNumber || source.stateNumber);
  const vin = cleanText(source.vin).toUpperCase();
  const year = cleanOptional(source.year);
  if (!label && !plate && !vin) return null;
  return {
    id: cleanText(source.id) || `${clientId}:vehicle:primary`,
    label: label || plate || vin || "Автомобиль клиента",
    plate,
    vin,
    year,
  };
}

function compactVehicle(vehicle?: MessengerContextVehicle | null) {
  if (!vehicle) return null;
  return [vehicle.label, vehicle.plate, vehicle.vin].filter(Boolean).join(" · ");
}

function conversationPhone(row: ConversationContextRow | Conversation) {
  return "participantPhone" in row ? row.participantPhone ?? null : row.participantPhone ?? null;
}

async function loadConversationRow(conversationId: string): Promise<ConversationContextRow | null> {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<ConversationContextRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      external_conversation_id AS "externalConversationId",
      external_chat_id AS "externalChatId",
      external_user_id AS "externalUserId",
      participant_name AS "participantName",
      participant_username AS "participantUsername",
      participant_phone AS "participantPhone",
      title,
      status,
      client_id AS "clientId",
      employee_id AS "employeeId",
      supplier_id AS "supplierId",
      related_case_id AS "relatedCaseId",
      related_appointment_id AS "relatedAppointmentId",
      related_shipment_id AS "relatedShipmentId",
      related_diagnostic_id AS "relatedDiagnosticId",
      assigned_to_id AS "assignedToId",
      updated_at AS "updatedAt",
      metadata_json AS "metadataJson"
    FROM messenger_conversations
    WHERE id = ${conversationId}
      AND organization_id = ${organizationId}
      AND branch_id = ${contextBranchId()}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadIdentity(row: ConversationContextRow) {
  if (!row.messengerAccountId || !row.externalUserId) return null;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      status: string;
      entityType: string;
      clientId: string | null;
      supplierId: string | null;
      employeeId: string | null;
    }>
  >`
    SELECT
      id,
      status,
      entity_type AS "entityType",
      client_id AS "clientId",
      supplier_id AS "supplierId",
      employee_id AS "employeeId"
    FROM communication_identities
    WHERE organization_id = ${row.organizationId}
      AND branch_id = ${contextBranchId()}
      AND messenger_account_id = ${row.messengerAccountId}
      AND external_user_id = ${row.externalUserId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function insertAudit(
  db: DbRunner,
  input: {
    organizationId: string;
    channel?: string;
    accountId?: string | null;
    action: string;
    actorId?: string | null;
    status?: string;
    message?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await db.$executeRaw`
    INSERT INTO integration_audit_logs
      (id, branch_id, organization_id, channel, messenger_account_id, actor_id, action, status, message, metadata_json, created_at)
    VALUES
      (${crypto.randomUUID()}, ${contextBranchId()}, ${input.organizationId}, ${input.channel ?? "telegram"}, ${input.accountId ?? null},
       ${input.actorId ?? null}, ${input.action}, ${input.status ?? "ok"}, ${input.message ?? null}, ${JSON.stringify(input.metadata ?? {})}::jsonb, now())
  `;
}

async function insertSystemMessage(db: DbRunner, row: ConversationContextRow, text: string) {
  await db.$executeRaw`
    INSERT INTO messenger_messages
      (id, branch_id, organization_id, conversation_id, messenger_account_id, channel, direction, author_type, text, attachments_json, status, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${contextBranchId()}, ${row.organizationId}, ${row.id}, ${row.messengerAccountId}, ${row.channel},
       'system', 'system', ${text}, '[]'::jsonb, 'read', now(), now())
  `;
}

async function upsertEntityLink(
  db: DbRunner,
  input: {
    organizationId: string;
    conversationId: string;
    entityType: string;
    entityId: string;
    relationType?: string;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await db.$executeRaw`
    INSERT INTO conversation_entity_links
      (id, branch_id, organization_id, conversation_id, entity_type, entity_id, relation_type, created_by_id, metadata_json, created_at)
    VALUES
      (${crypto.randomUUID()}, ${contextBranchId()}, ${input.organizationId}, ${input.conversationId}, ${input.entityType}, ${input.entityId},
       ${input.relationType ?? "RELATED"}, ${input.actorId ?? null}, ${JSON.stringify(input.metadata ?? {})}::jsonb, now())
    ON CONFLICT (branch_id, organization_id, conversation_id, entity_type, entity_id, relation_type)
    DO UPDATE SET metadata_json = EXCLUDED.metadata_json
  `;
}

async function deletePrimaryLinks(db: DbRunner, organizationId: string, conversationId: string, entityType: string) {
  await db.$executeRaw`
    DELETE FROM conversation_entity_links
    WHERE organization_id = ${organizationId}
      AND branch_id = ${contextBranchId()}
      AND conversation_id = ${conversationId}
      AND entity_type = ${entityType}
      AND relation_type = 'PRIMARY'
  `;
}

async function upsertCommunicationIdentity(
  db: DbRunner,
  row: ConversationContextRow,
  input: {
    entityType: "CLIENT" | "SUPPLIER" | "EMPLOYEE" | "OTHER";
    clientId?: string | null;
    supplierId?: string | null;
    employeeId?: string | null;
    status?: string;
    matchSource?: string;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  if (!row.messengerAccountId || !row.externalUserId) return;
  await db.$executeRaw`
    INSERT INTO communication_identities
      (id, branch_id, organization_id, channel, messenger_account_id, external_user_id, external_conversation_id,
       username, display_name, phone_normalized, entity_type, client_id, supplier_id, employee_id, status,
       match_source, linked_by_id, linked_at, verified_at, metadata_json, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${contextBranchId()}, ${row.organizationId}, ${row.channel}, ${row.messengerAccountId}, ${row.externalUserId}, ${row.externalConversationId},
       ${row.participantUsername}, ${row.participantName || row.title}, ${normalizePhoneKey(row.participantPhone)}, ${input.entityType},
       ${input.clientId ?? null}, ${input.supplierId ?? null}, ${input.employeeId ?? null}, ${input.status ?? "CONFIRMED"},
       ${input.matchSource ?? "MANUAL"}, ${input.actorId ?? null}, now(), now(), ${JSON.stringify(input.metadata ?? {})}::jsonb, now(), now())
    ON CONFLICT (branch_id, organization_id, messenger_account_id, external_user_id)
    DO UPDATE SET
      external_conversation_id = EXCLUDED.external_conversation_id,
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      phone_normalized = COALESCE(EXCLUDED.phone_normalized, communication_identities.phone_normalized),
      entity_type = EXCLUDED.entity_type,
      client_id = EXCLUDED.client_id,
      supplier_id = EXCLUDED.supplier_id,
      employee_id = EXCLUDED.employee_id,
      status = EXCLUDED.status,
      match_source = EXCLUDED.match_source,
      linked_by_id = EXCLUDED.linked_by_id,
      linked_at = COALESCE(communication_identities.linked_at, now()),
      verified_at = now(),
      metadata_json = EXCLUDED.metadata_json,
      updated_at = now()
  `;
}

async function loadClient(id: string | null | undefined) {
  if (!id) return null;
  return prisma.localCounterparty.findFirst({
    where: { id },
  });
}

async function loadClientCases(client: LocalCounterparty, conversationId: string) {
  return prisma.crmDeal.findMany({
    where: {
      status: "open",
      OR: [
        { conversationId },
        ...(client.normalizedPhone ? [{ phoneNormalized: client.normalizedPhone }] : []),
        { notes: { contains: `conversation:${conversationId}` } },
      ],
    },
    orderBy: [{ nextActionAt: "asc" }, { nextContactAt: "asc" }, { updatedAt: "desc" }],
    take: 8,
  });
}

async function loadContextLinks(organizationId: string, conversationId: string) {
  return prisma.$queryRaw<
    Array<{
      entityType: string;
      entityId: string;
      relationType: string;
      metadataJson: Record<string, unknown> | null;
      createdAt: Date;
    }>
  >`
    SELECT
      entity_type AS "entityType",
      entity_id AS "entityId",
      relation_type AS "relationType",
      metadata_json AS "metadataJson",
      created_at AS "createdAt"
    FROM conversation_entity_links
    WHERE organization_id = ${organizationId}
      AND branch_id = ${contextBranchId()}
      AND conversation_id = ${conversationId}
    ORDER BY created_at DESC
  `;
}

async function loadClientContext(row: ConversationContextRow, client: LocalCounterparty): Promise<MessengerContextClient> {
  const rawVehicle = vehicleFromRaw(client.id, client.raw);
  const links = await loadContextLinks(row.organizationId, row.id);
  const vehicleLink = links.find((link) => link.entityType === VEHICLE_LINK_TYPE && link.relationType === "PRIMARY");
  const linkedVehicle =
    vehicleLink && vehicleLink.metadataJson
      ? ({
          id: vehicleLink.entityId,
          label: cleanText(vehicleLink.metadataJson.label) || rawVehicle?.label || "Автомобиль клиента",
          plate: cleanText(vehicleLink.metadataJson.plate) || rawVehicle?.plate || "",
          vin: cleanText(vehicleLink.metadataJson.vin).toUpperCase() || rawVehicle?.vin || "",
          year: cleanOptional(vehicleLink.metadataJson.year),
        } satisfies MessengerContextVehicle)
      : null;
  const vehicle = linkedVehicle ?? rawVehicle;
  const vehicles = [vehicle].filter(Boolean) as MessengerContextVehicle[];
  const cases = await loadClientCases(client, row.id);
  const shipments = await prisma.localDemand.findMany({
    where: {
      OR: [
        { counterpartyId: client.id },
        ...(client.id ? [{ counterpartyId: client.id }] : []),
        { id: row.relatedShipmentId ?? "__none__" },
      ],
    },
    orderBy: [{ momentAt: "desc" }],
    take: 5,
  });
  const diagnostics = await prisma.diagnosticMapSession.findMany({
    where: {
      OR: [
        { clientId: client.id },
        ...(client.id ? [{ clientId: client.id }] : []),
        ...(client.phone ? [{ clientPhone: { contains: client.phone.slice(-6) } }] : []),
        { id: row.relatedDiagnosticId ?? "__none__" },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 5,
  });
  const relatedBooking = await loadRelatedBooking(row.relatedAppointmentId);
  const appointment = relatedBooking ? bookingForMessenger(relatedBooking) : null;
  const tasks = await prisma.crmDeal.findMany({
    where: {
      source: "messenger-task",
      status: "open",
      notes: { contains: `conversation:${row.id}` },
    },
    orderBy: [{ nextContactAt: "asc" }, { updatedAt: "desc" }],
    take: 5,
  });
  const activeCase = cases[0] ?? null;
  const activeCaseDueAt = activeCase?.nextActionAt ?? activeCase?.nextContactAt ?? null;
  return {
    id: client.id,
    name: client.name,
    phone: client.phone ?? client.normalizedPhone ?? "",
    type: counterpartyType(client),
    telegramUsername: row.participantUsername,
    vehicle: vehicle ?? undefined,
    vehicles,
    activeCase: activeCase
      ? {
          id: activeCase.id,
          title: activeCase.title,
          status: clientCaseStatusLabel(activeCase.caseStatus, undefined),
          responsible: activeCase.responsibleLogin ?? "не назначен",
          deadline: activeCaseDueAt?.toISOString() ?? "",
          overdue: Boolean(activeCaseDueAt && activeCaseDueAt.getTime() < Date.now()),
        }
      : undefined,
    appointment: appointment
      ? {
          id: appointment.id,
          date: `${appointment.slot.date} ${appointment.slot.time}`,
          service: appointment.comment || "Запись клиента",
          status: "создана",
        }
      : undefined,
    shipments: shipments.map((shipment) => ({
      id: shipment.id,
      title: `Отгрузка ${shipment.name}`,
      amount: formatMoney(shipment.sumCents),
      status: shipment.applicable ? "проведена" : "черновик",
    })),
    diagnostics: diagnostics.map((diagnostic) => ({
      id: diagnostic.id,
      title: [diagnostic.brand, diagnostic.model, diagnostic.licensePlate].filter(Boolean).join(" · ") || "Диагностика",
      status: diagnostic.status.toString(),
      publicReportUrl: diagnostic.publicToken ? `/report/${diagnostic.publicToken}` : undefined,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
    })),
  };
}

async function clientSuggestionFromCounterparty(
  counterparty: LocalCounterparty,
  score: number,
  reason: string
): Promise<MessengerClientSuggestion> {
  return {
    id: counterparty.id,
    name: counterparty.name,
    phone: counterparty.phone ?? counterparty.normalizedPhone ?? "",
    type: counterpartyType(counterparty),
    score,
    reason,
    vehicle: vehicleFromRaw(counterparty.id, counterparty.raw) ?? undefined,
  };
}

export async function searchMessengerClients(query: string, limit = 10) {
  await ensureMessengerIntegrationCoreSchema();
  const q = query.trim();
  const normalizedPhone = normalizePhoneKey(q);
  if (!q && !normalizedPhone) return [];
  const branchId = getScopedBranchId();
  const clients = await prisma.localCounterparty.findMany({
    where: {
      branchId,
      archived: false,
      ...anonymousRetailCounterpartyExclusion(branchId),
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(normalizedPhone
          ? [
              { normalizedPhone: { contains: normalizedPhone } },
              { phone: { contains: normalizedPhone.slice(-7) } },
            ]
          : []),
        { inn: { contains: q } },
        { raw: { path: ["vehicle", "vin"], string_contains: q.toUpperCase() } },
        { raw: { path: ["vehicle", "plate"], string_contains: q.toUpperCase() } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(30, Math.max(1, limit)),
  });
  return Promise.all(clients.map((client, index) => clientSuggestionFromCounterparty(client, 90 - index, "поиск")));
}

export async function suggestMessengerClients(conversationId: string) {
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const normalizedPhone = normalizePhoneKey(row.participantPhone);
  const identity = await loadIdentity(row);
  const suggestions = new Map<string, MessengerClientSuggestion>();

  if (identity?.entityType === "CLIENT" && identity.clientId) {
    const client = await loadClient(identity.clientId);
    if (client) suggestions.set(client.id, await clientSuggestionFromCounterparty(client, 100, "подтверждённая связь Telegram"));
  }

  if (normalizedPhone) {
    const branchId = getScopedBranchId();
    const phoneClients = await prisma.localCounterparty.findMany({
      where: {
        branchId,
        archived: false,
        ...anonymousRetailCounterpartyExclusion(branchId),
        OR: [{ normalizedPhone }, { phone: { contains: normalizedPhone.slice(-7) } }],
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5,
    });
    for (const client of phoneClients) {
      if (!suggestions.has(client.id)) {
        suggestions.set(client.id, await clientSuggestionFromCounterparty(client, 92, "совпадает телефон"));
      }
    }
  }

  const name = cleanText(row.participantName || row.title);
  if (name.length >= 3) {
    const branchId = getScopedBranchId();
    const nameClients = await prisma.localCounterparty.findMany({
      where: {
        branchId,
        archived: false,
        ...anonymousRetailCounterpartyExclusion(branchId),
        name: { contains: name, mode: "insensitive" },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5,
    });
    for (const client of nameClients) {
      if (!suggestions.has(client.id)) {
        suggestions.set(client.id, await clientSuggestionFromCounterparty(client, 70, "похоже имя"));
      }
    }
  }

  return [...suggestions.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

function contextActions(row: ConversationContextRow, context: MessengerContextClient | null): MessengerContextAction[] {
  const linked = Boolean(context);
  const hasVehicle = Boolean(context?.vehicle);
  const hasShipment = Boolean(row.relatedShipmentId || context?.shipments.length);
  const hasAppointment = Boolean(row.relatedAppointmentId || context?.appointment);
  return [
    { key: "link-client", label: "Привязать клиента", enabled: !linked },
    { key: "change-client", label: "Сменить клиента", enabled: linked },
    { key: "unlink-client", label: "Отвязать клиента", enabled: linked },
    { key: "select-vehicle", label: "Выбрать авто", enabled: linked && Boolean(context?.vehicles.length) },
    { key: "create-case", label: "Создать дело", enabled: linked },
    { key: "create-appointment", label: "Создать запись", enabled: linked, reason: linked ? undefined : "Сначала привяжите клиента" },
    { key: "create-shipment", label: "Создать отгрузку", enabled: linked && hasVehicle },
    { key: "create-task", label: "Поставить задачу", enabled: true },
    { key: "send-diagnostic-report", label: "Отправить отчёт", enabled: linked && Boolean(context?.diagnostics.length) },
    { key: "send-precheck", label: "Отправить предчек", enabled: hasShipment },
    { key: "send-appointment-link", label: "Отправить запись", enabled: hasAppointment },
    { key: "send-shipment-card", label: "Отправить отгрузку", enabled: hasShipment },
  ];
}

export async function getConversationContext(conversationId: string): Promise<MessengerConversationContext> {
  await ensureMessengerIntegrationCoreSchema();
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const identity = await loadIdentity(row);
  let state: MessengerContextState =
    row.status === "archived"
      ? "archived"
      : row.employeeId || identity?.entityType === "EMPLOYEE"
        ? "employee"
        : row.supplierId || identity?.entityType === "SUPPLIER"
          ? "supplier"
          : "unlinked";

  const resolvedClientId = row.clientId || (identity?.entityType === "CLIENT" ? identity.clientId : null);
  const client = await loadClient(resolvedClientId);
  const clientContext = client ? await loadClientContext(row, client) : null;
  const suggestions = clientContext ? [] : await suggestMessengerClients(conversationId);
  if (clientContext) {
    state = "linked";
  } else if (state === "unlinked" && suggestions.length > 0) {
    state = "suggestions";
  } else if (state === "unlinked" && identity?.entityType === "CLIENT" && identity.clientId) {
    state = "conflict";
  }

  return {
    state,
    conversationId: row.id,
    organizationId: row.organizationId,
    expectedUpdatedAt: row.updatedAt.toISOString(),
    identity: identity
      ? {
          status: identity.status,
          entityType: identity.entityType,
          clientId: identity.clientId,
          conflictClientId: identity.entityType === "CLIENT" && identity.clientId && identity.clientId !== row.clientId ? identity.clientId : null,
        }
      : null,
    client: clientContext,
    suggestions,
    selectedVehicle: clientContext?.vehicle ?? null,
    vehicles: clientContext?.vehicles ?? [],
    actions: contextActions(row, clientContext),
    updatedAt: nowIso(),
  };
}

async function assertConversationVersion(row: ConversationContextRow, expectedUpdatedAt?: string | null) {
  if (!expectedUpdatedAt) return;
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) return;
  if (Math.abs(row.updatedAt.getTime() - expected.getTime()) > 1000) {
    throw new MessengerContextError("Диалог изменился. Обновите контекст и повторите действие.", 409);
  }
}

async function ensureNoClientIdentityConflict(row: ConversationContextRow, clientId: string) {
  const identity = await loadIdentity(row);
  if (identity?.entityType === "CLIENT" && identity.clientId && identity.clientId !== clientId && identity.status === "CONFIRMED") {
    throw new MessengerContextError("Этот Telegram-профиль уже привязан к другому клиенту.", 409);
  }
}

export async function linkClientToConversation(
  conversationId: string,
  input: { clientId: string; expectedUpdatedAt?: string | null; vehicle?: MessengerContextVehicle | null },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  if (row.status === "archived") throw new MessengerContextError("Архивный диалог нельзя изменить", 409);
  await assertConversationVersion(row, input.expectedUpdatedAt);
  const client = await loadClient(input.clientId);
  if (!client) throw new MessengerContextError("Клиент не найден", 404);
  if (isAnonymousRetailCounterparty(client)) {
    throw new MessengerContextError("Системного контрагента нельзя привязать к диалогу или автомобилю.", 400);
  }
  await ensureNoClientIdentityConflict(row, client.id);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE messenger_conversations
      SET client_id = ${client.id},
          employee_id = NULL,
          supplier_id = NULL,
          status = 'open',
          updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${row.organizationId}
        AND branch_id = ${contextBranchId()}
    `;
    await upsertCommunicationIdentity(tx, row, {
      entityType: "CLIENT",
      clientId: client.id,
      actorId: actorId(actor),
      matchSource: "MANUAL",
      metadata: { clientName: client.name },
    });
    await upsertEntityLink(tx, {
      organizationId: row.organizationId,
      conversationId: row.id,
      entityType: CLIENT_LINK_TYPE,
      entityId: client.id,
      relationType: "PRIMARY",
      actorId: actorId(actor),
      metadata: { clientName: client.name },
    });
    const vehicle = input.vehicle ?? vehicleFromRaw(client.id, client.raw);
    if (vehicle) {
      await deletePrimaryLinks(tx, row.organizationId, row.id, VEHICLE_LINK_TYPE);
      await upsertEntityLink(tx, {
        organizationId: row.organizationId,
        conversationId: row.id,
        entityType: VEHICLE_LINK_TYPE,
        entityId: vehicle.id,
        relationType: "PRIMARY",
        actorId: actorId(actor),
        metadata: vehicle,
      });
    }
    await insertSystemMessage(tx, row, `Клиент привязан к диалогу: ${client.name}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.link_client",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, clientId: client.id },
    });
  });

  return getConversationContext(row.id);
}

export async function createAndLinkClient(
  conversationId: string,
  input: {
    name?: string | null;
    phone?: string | null;
    vehicle?: Partial<MessengerContextVehicle> | null;
    expectedUpdatedAt?: string | null;
    forceDuplicate?: boolean;
  },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  await assertConversationVersion(row, input.expectedUpdatedAt);
  const name = cleanOptional(input.name) || row.participantName || row.title || "Клиент из Telegram";
  const phone = cleanOptional(input.phone) || row.participantPhone || null;
  const normalizedPhone = normalizePhoneKey(phone);
  if (normalizedPhone && !input.forceDuplicate) {
    const existing = await prisma.localCounterparty.findFirst({ where: { normalizedPhone, archived: false } });
    if (existing) {
      throw new MessengerContextError(`Клиент с таким телефоном уже есть: ${existing.name}`, 409);
    }
  }
  const vehicle = input.vehicle
    ? ({
        id: input.vehicle.id || `${crypto.randomUUID()}`,
        label: cleanText(input.vehicle.label) || "Автомобиль клиента",
        plate: cleanText(input.vehicle.plate),
        vin: cleanText(input.vehicle.vin).toUpperCase(),
        year: cleanOptional(input.vehicle.year),
      } satisfies MessengerContextVehicle)
    : null;

  await ensureNoClientIdentityConflict(row, "__new_client__");
  await prisma.$transaction(async (tx) => {
    const client = await tx.localCounterparty.create({
      data: {
        name,
        displayName: name,
        category: "INDIVIDUAL",
        phone,
        normalizedPhone: normalizedPhone || null,
        email: null,
        inn: null,
        archived: false,
        companyType: "individual",
        counterpartyTypeName: "Физлицо",
        searchText: [name, phone, vehicle?.label, vehicle?.plate, vehicle?.vin].filter(Boolean).join(" "),
        raw: jsonInput({ source: "messenger", conversationId: row.id, vehicle }),
      },
    });
    await tx.$executeRaw`
      UPDATE messenger_conversations
      SET client_id = ${client.id},
          employee_id = NULL,
          supplier_id = NULL,
          status = 'open',
          updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${row.organizationId}
        AND branch_id = ${contextBranchId()}
    `;
    await upsertCommunicationIdentity(tx, row, {
      entityType: "CLIENT",
      clientId: client.id,
      actorId: actorId(actor),
      matchSource: "MANUAL_CREATE",
      metadata: { clientName: client.name },
    });
    await upsertEntityLink(tx, {
      organizationId: row.organizationId,
      conversationId: row.id,
      entityType: CLIENT_LINK_TYPE,
      entityId: client.id,
      relationType: "PRIMARY",
      actorId: actorId(actor),
      metadata: { clientName: client.name },
    });
    if (vehicle) {
      await upsertEntityLink(tx, {
        organizationId: row.organizationId,
        conversationId: row.id,
        entityType: VEHICLE_LINK_TYPE,
        entityId: vehicle.id,
        relationType: "PRIMARY",
        actorId: actorId(actor),
        metadata: vehicle,
      });
    }
    await insertSystemMessage(tx, row, `Создан и привязан клиент: ${client.name}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.create_and_link_client",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, clientId: client.id },
    });
  });

  return getConversationContext(row.id);
}

export async function unlinkClientFromConversation(conversationId: string, actor?: ContextActor | null) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE messenger_conversations
      SET client_id = NULL,
          updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${row.organizationId}
        AND branch_id = ${contextBranchId()}
    `;
    await deletePrimaryLinks(tx, row.organizationId, row.id, CLIENT_LINK_TYPE);
    if (row.messengerAccountId && row.externalUserId) {
      await tx.$executeRaw`
        UPDATE communication_identities
        SET status = 'UNLINKED',
            client_id = NULL,
            entity_type = 'OTHER',
            updated_at = now()
        WHERE organization_id = ${row.organizationId}
          AND branch_id = ${contextBranchId()}
          AND messenger_account_id = ${row.messengerAccountId}
          AND external_user_id = ${row.externalUserId}
      `;
    }
    await insertSystemMessage(tx, row, "Клиент отвязан от диалога. Переписка и связанные документы сохранены.");
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.unlink_client",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, previousClientId: row.clientId },
    });
  });
  return getConversationContext(row.id);
}

export async function classifyConversation(
  conversationId: string,
  input: { type: "client" | "supplier" | "employee" | "unknown"; expectedUpdatedAt?: string | null },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  await assertConversationVersion(row, input.expectedUpdatedAt);
  const entityType = input.type.toUpperCase() as "CLIENT" | "SUPPLIER" | "EMPLOYEE" | "OTHER";
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE messenger_conversations
      SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify({ classification: input.type })}::jsonb,
          updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${row.organizationId}
        AND branch_id = ${contextBranchId()}
    `;
    await upsertCommunicationIdentity(tx, row, {
      entityType,
      status: input.type === "unknown" ? "SUGGESTED" : "CONFIRMED",
      actorId: actorId(actor),
      metadata: { classification: input.type },
    });
    await insertSystemMessage(tx, row, `Диалог классифицирован: ${input.type}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.classify",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, type: input.type },
    });
  });
  return getConversationContext(row.id);
}

export async function selectConversationVehicle(
  conversationId: string,
  input: { vehicle: MessengerContextVehicle; expectedUpdatedAt?: string | null },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  await assertConversationVersion(row, input.expectedUpdatedAt);
  if (!row.clientId) throw new MessengerContextError("Сначала привяжите клиента", 409);
  await prisma.$transaction(async (tx) => {
    await deletePrimaryLinks(tx, row.organizationId, row.id, VEHICLE_LINK_TYPE);
    await upsertEntityLink(tx, {
      organizationId: row.organizationId,
      conversationId: row.id,
      entityType: VEHICLE_LINK_TYPE,
      entityId: input.vehicle.id,
      relationType: "PRIMARY",
      actorId: actorId(actor),
      metadata: input.vehicle,
    });
    await insertSystemMessage(tx, row, `Выбран автомобиль: ${compactVehicle(input.vehicle) ?? input.vehicle.label}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.select_vehicle",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, vehicle: input.vehicle },
    });
  });
  return getConversationContext(row.id);
}

export async function createCaseForConversation(
  conversationId: string,
  input: { title?: string | null; responsibleLogin?: string | null; deadline?: string | null; forceNew?: boolean },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const client = await loadClient(row.clientId);
  if (!client) throw new MessengerContextError("Сначала привяжите клиента", 409);
  if (row.relatedCaseId && !input.forceNew) {
    const existing = await prisma.crmDeal.findUnique({ where: { id: row.relatedCaseId } });
    if (existing) return { context: await getConversationContext(row.id), case: existing, alreadyExists: true };
  }
  const stage = await getFirstCrmStage();
  if (!stage) throw new MessengerContextError("Не найдены стадии CRM", 500);
  const messages = await listMessages(row.id);
  const lastInboundMessage = [...messages].reverse().find((message) => message.direction === "inbound");
  const lastInbound = lastInboundMessage?.text;
  const clientContext = await loadClientContext(row, client);
  const title = cleanOptional(input.title) || `Дело из Telegram: ${client.name}`;
  let deal: Awaited<ReturnType<typeof prisma.crmDeal.create>> | null = null;
  await prisma.$transaction(async (tx) => {
    deal = await tx.crmDeal.create({
      data: {
        title,
        customerName: client.name,
        phoneNormalized: client.normalizedPhone ?? normalizePhoneKey(client.phone),
        vehicle: compactVehicle(clientContext.vehicle),
        source: "messenger",
        clientType: "regular",
        nextAction: defaultNextActionForCaseStatus("calculation_needed"),
        stageId: stage.id,
        responsibleLogin: cleanOptional(input.responsibleLogin) || actor?.login || null,
        conversationId: row.id,
        caseStatus: "calculation_needed",
        caseType: "message",
        caseKey: `client_message:${row.id}`,
        lastClientMessageAt: lastInboundMessage?.createdAt ? new Date(lastInboundMessage.createdAt) : null,
        nextContactAt: cleanOptional(input.deadline) ? new Date(input.deadline as string) : null,
        nextActionAt: cleanOptional(input.deadline) ? new Date(input.deadline as string) : null,
        notes: [`messenger conversation:${row.id}`, lastInbound ? `Последнее сообщение: ${lastInbound}` : null].filter(Boolean).join("\n"),
        createdByLogin: actor?.login || "messenger",
      },
    });
    await tx.$executeRaw`
      UPDATE messenger_conversations
      SET related_case_id = ${deal.id},
          status = 'open',
          updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${row.organizationId}
        AND branch_id = ${contextBranchId()}
    `;
    await upsertEntityLink(tx, {
      organizationId: row.organizationId,
      conversationId: row.id,
      entityType: CASE_LINK_TYPE,
      entityId: deal.id,
      relationType: "PRIMARY",
      actorId: actorId(actor),
      metadata: { title: deal.title },
    });
    await insertSystemMessage(tx, row, `Создано дело клиента: ${deal.title}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.create_case",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, caseId: deal.id },
    });
  });
  if (!deal) throw new MessengerContextError("Не удалось создать дело", 500);
  return { context: await getConversationContext(row.id), case: deal, alreadyExists: false };
}

export async function linkCaseToConversation(
  conversationId: string,
  input: { caseId: string },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const deal = await prisma.crmDeal.findUnique({ where: { id: input.caseId } });
  if (!deal) throw new MessengerContextError("Дело не найдено", 404);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE messenger_conversations
      SET related_case_id = ${deal.id}, updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${row.organizationId}
        AND branch_id = ${contextBranchId()}
    `;
    await upsertEntityLink(tx, {
      organizationId: row.organizationId,
      conversationId: row.id,
      entityType: CASE_LINK_TYPE,
      entityId: deal.id,
      relationType: "PRIMARY",
      actorId: actorId(actor),
      metadata: { title: deal.title },
    });
    await insertSystemMessage(tx, row, `К диалогу привязано дело: ${deal.title}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.link_case",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, caseId: deal.id },
    });
  });
  return { context: await getConversationContext(row.id), case: deal };
}

export async function createAppointmentForConversation(
  conversationId: string,
  input: { slotId?: string; oilId?: string; vin?: string; serviceName?: string; comment?: string },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const client = await loadClient(row.clientId);
  if (!client) throw new MessengerContextError("Сначала привяжите клиента", 409);
  const clientContext = await loadClientContext(row, client);
  try {
    const branchId = contextBranchId();
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } });
    if (!branch) throw new MessengerContextError("Филиал не найден", 404);
    const slotMatch = input.slotId?.match(/^(20\d{2}-\d{2}-\d{2})-(\d{2})(\d{2})$/);
    if (!slotMatch) throw new MessengerContextError("Выберите время в собственном журнале записи", 422);
    const localDate = slotMatch[1];
    const localTime = `${slotMatch[2]}:${slotMatch[3]}`;
    const service = await prisma.bookingService.findFirst({
      where: {
        branchId,
        status: "ACTIVE",
        ...(input.serviceName ? { name: { contains: input.serviceName, mode: "insensitive" } } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }) ?? await prisma.bookingService.findFirst({
      where: { branchId, status: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    if (!service) throw new MessengerContextError("В филиале не настроены услуги записи", 409);
    const availability = await getBookingAvailability({
      branchId,
      localDate,
      serviceIds: [service.id],
      onlineOnly: false,
      respectLeadTime: false,
    });
    const slot = availability.slots.find((item) => item.localTime === localTime);
    if (!slot) throw new MessengerContextError("Выбранное время занято или не входит в расписание", 409);
    const vehicleWords = (clientContext.vehicle?.label ?? "").split(/\s+/u).filter(Boolean);
    const clientPhone = client.phone ?? client.normalizedPhone ?? conversationPhone(row);
    if (!clientPhone) throw new MessengerContextError("У клиента не указан телефон", 422);
    const result = await createBooking({
      branchId,
      serviceIds: [service.id],
      masterMembershipId: slot.master.membershipId,
      startsAt: zonedLocalToUtc(localDate, localTime, branch.timezone),
      customerName: client.name,
      phone: clientPhone,
      clientId: client.id,
      vehicle: {
        make: vehicleWords[0] || "Автомобиль",
        model: vehicleWords.slice(1).join(" ") || "Не указан",
        vin: input.vin || clientContext.vehicle?.vin,
        plate: clientContext.vehicle?.plate,
        year: clientContext.vehicle?.year,
      },
      comment: input.comment || input.serviceName || "Запись из Messenger",
      source: "ADMIN",
    }, { kind: "USER", userId: actorId(actor), respectLeadTime: false });
    const appointment = bookingForMessenger(result.booking);
    await notifyBookingCreated(result.booking).catch((error) => console.warn("[booking/messenger-notification]", error));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE messenger_conversations
        SET related_appointment_id = ${appointment.id}, updated_at = now()
        WHERE id = ${row.id}
          AND organization_id = ${row.organizationId}
          AND branch_id = ${contextBranchId()}
      `;
      await upsertEntityLink(tx, {
        organizationId: row.organizationId,
        conversationId: row.id,
        entityType: APPOINTMENT_LINK_TYPE,
        entityId: appointment.id,
        relationType: "PRIMARY",
        actorId: actorId(actor),
        metadata: { date: appointment.slot.date, time: appointment.slot.time, service: appointment.comment },
      });
      await insertSystemMessage(tx, row, `Создана запись: ${appointment.slot.date} ${appointment.slot.time}.`);
      await insertAudit(tx, {
        organizationId: row.organizationId,
        accountId: row.messengerAccountId,
        action: "conversation.create_appointment",
        actorId: actorId(actor),
        metadata: { conversationId: row.id, appointmentId: appointment.id },
      });
    });
    return { context: await getConversationContext(row.id), appointment };
  } catch (error) {
    if (error instanceof BookingError) throw new MessengerContextError(error.message, error.status);
    throw error;
  }
}

export async function createShipmentForConversation(
  conversationId: string,
  input: { forceNew?: boolean; description?: string | null },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const client = await loadClient(row.clientId);
  if (!client) throw new MessengerContextError("Сначала привяжите клиента", 409);
  if (row.relatedShipmentId && !input.forceNew) {
    const existing = await prisma.localDemand.findUnique({ where: { id: row.relatedShipmentId } });
    if (existing) return { context: await getConversationContext(row.id), shipment: existing, alreadyExists: true };
  }
  const organization = await prisma.localOrganization.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  const store = await prisma.localStore.findFirst({
    where: {
      archived: false,
      ...(organization ? { OR: [{ organizationId: organization.id }, { organizationId: null }] } : {}),
    },
    orderBy: [{ isMain: "desc" }, { updatedAt: "desc" }],
  });
  if (!organization) throw new MessengerContextError("Организация не найдена в локальной БД", 409);
  if (!store) throw new MessengerContextError("Склад не найден в локальной БД", 409);
  const body: CreateDemandBody = {
    organization: { meta: localMeta("organization", organization.id) },
    store: { meta: localMeta("store", store.id) },
    agent: { meta: localMeta("counterparty", client.id) },
    applicable: false,
    description: cleanOptional(input.description) || `Черновик из Messenger, conversation:${row.id}`,
    positions: [],
  };
  const created = await createLocalDemand(body, { ecoUserName: actor?.login ?? undefined });
  if (!created.ok) throw new MessengerContextError(created.error, 409);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE messenger_conversations
      SET related_shipment_id = ${created.id}, updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${row.organizationId}
        AND branch_id = ${contextBranchId()}
    `;
    await upsertEntityLink(tx, {
      organizationId: row.organizationId,
      conversationId: row.id,
      entityType: SHIPMENT_LINK_TYPE,
      entityId: created.id,
      relationType: "PRIMARY",
      actorId: actorId(actor),
      metadata: { name: created.name, href: created.href },
    });
    await insertSystemMessage(tx, row, `Создан черновик отгрузки: ${created.name}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.create_shipment",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, shipmentId: created.id },
    });
  });
  return { context: await getConversationContext(row.id), shipment: created, alreadyExists: false };
}

export async function createTaskForConversation(
  conversationId: string,
  input: { title?: string | null; responsibleLogin?: string | null; dueAt?: string | null; priority?: string | null },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const client = await loadClient(row.clientId);
  const stage = await getFirstCrmStage();
  if (!stage) throw new MessengerContextError("Не найдены стадии CRM", 500);
  const title = cleanOptional(input.title) || `Задача по диалогу: ${row.participantName || row.title}`;
  let task: Awaited<ReturnType<typeof prisma.crmDeal.create>> | null = null;
  await prisma.$transaction(async (tx) => {
    task = await tx.crmDeal.create({
      data: {
        title,
        customerName: client?.name ?? row.participantName ?? row.title,
        phoneNormalized: normalizePhoneKey(client?.phone ?? row.participantPhone),
        vehicle: client ? compactVehicle(vehicleFromRaw(client.id, client.raw)) : null,
        source: "messenger-task",
        clientType: client ? "regular" : "unlinked",
        nextAction: title,
        stageId: stage.id,
        responsibleLogin: cleanOptional(input.responsibleLogin) || row.assignedToId || actor?.login || null,
        nextContactAt: cleanOptional(input.dueAt) ? new Date(input.dueAt as string) : null,
        notes: [`messenger task`, `conversation:${row.id}`, cleanOptional(input.priority) ? `priority:${input.priority}` : null].filter(Boolean).join("\n"),
        createdByLogin: actor?.login || "messenger",
      },
    });
    await upsertEntityLink(tx, {
      organizationId: row.organizationId,
      conversationId: row.id,
      entityType: TASK_LINK_TYPE,
      entityId: task.id,
      relationType: "CREATED_FROM_CONVERSATION",
      actorId: actorId(actor),
      metadata: { title: task.title, dueAt: task.nextContactAt?.toISOString() ?? null },
    });
    await insertSystemMessage(tx, row, `Поставлена задача: ${task.title}.`);
    await insertAudit(tx, {
      organizationId: row.organizationId,
      accountId: row.messengerAccountId,
      action: "conversation.create_task",
      actorId: actorId(actor),
      metadata: { conversationId: row.id, taskId: task.id },
    });
  });
  if (!task) throw new MessengerContextError("Не удалось создать задачу", 500);
  return { context: await getConversationContext(row.id), task };
}

async function sendTextAndAudit(
  row: ConversationContextRow,
  text: string,
  action: string,
  actor?: ContextActor | null,
  metadata?: Record<string, unknown>,
  options?: Pick<SendMessageInput, "linkButton" | "disableWebPagePreview">
) {
  const result = await sendMessage({ conversationId: row.id, text, ...options });
  if (!result?.ok) throw new MessengerContextError(result?.error ?? "Не удалось отправить сообщение", 502);
  await insertAudit(prisma, {
    organizationId: row.organizationId,
    accountId: row.messengerAccountId,
    action,
    actorId: actorId(actor),
    metadata: { conversationId: row.id, ...metadata },
  });
  return { context: await getConversationContext(row.id), message: result.message };
}

export async function sendDiagnosticReportFromConversation(
  conversationId: string,
  input: { diagnosticId?: string | null; origin?: string | null },
  actor?: ContextActor | null
) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const diagnostic = await prisma.diagnosticMapSession.findFirst({
    where: { id: cleanOptional(input.diagnosticId) || row.relatedDiagnosticId || undefined },
    orderBy: { updatedAt: "desc" },
  });
  if (!diagnostic?.publicToken) throw new MessengerContextError("Публичный отчёт диагностики не найден", 404);
  await syncDiagnosticVehicleFromShipment(diagnostic.id, { mode: "fillMissingOnly", reason: "messenger-send-report", userLogin: actor?.login });
  const syncedDiagnostic = await prisma.diagnosticMapSession.findUnique({ where: { id: diagnostic.id } });
  const currentDiagnostic = syncedDiagnostic ?? diagnostic;
  const origin = cleanOptional(input.origin)?.replace(/\/$/, "") || "";
  const reportUrl = `${origin}/report/${currentDiagnostic.publicToken}`;
  const clientName = currentDiagnostic.clientName || "клиент";
  const vehicleName = [currentDiagnostic.brand, currentDiagnostic.model, currentDiagnostic.licensePlate].filter(Boolean).join(" ") || "автомобилю";
  const recommendationCount = currentDiagnostic.attentionCount;
  return sendTextAndAudit(
    row,
    `Диагностика готова\n\n${buildDiagnosticReportMessage({
      clientName,
      car: vehicleName,
      reportUrl,
      checkedCount: currentDiagnostic.totalCount,
      recommendationCount,
      criticalCount: currentDiagnostic.replaceCount,
    }, { includeLink: false })}`,
    "conversation.send_diagnostic_report",
    actor,
    { diagnosticId: diagnostic.id },
    { linkButton: { text: "Открыть отчёт", url: reportUrl }, disableWebPagePreview: true }
  );
}

export async function sendPrecheckFromConversation(conversationId: string, actor?: ContextActor | null) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const shipmentId = row.relatedShipmentId;
  if (!shipmentId) throw new MessengerContextError("Сначала создайте или привяжите отгрузку", 409);
  const shipment = await prisma.localDemand.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new MessengerContextError("Отгрузка не найдена", 404);
  return sendTextAndAudit(
    row,
    `Предчек по отгрузке ${shipment.name}: ${formatMoney(shipment.sumCents)}.\nПозиции и внутренние цены в Telegram не отправляем автоматически.`,
    "conversation.send_precheck",
    actor,
    { shipmentId }
  );
}

export async function sendAppointmentLinkFromConversation(conversationId: string, actor?: ContextActor | null) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const relatedBooking = await loadRelatedBooking(row.relatedAppointmentId);
  const appointment = relatedBooking ? bookingForMessenger(relatedBooking) : null;
  if (!appointment) throw new MessengerContextError("Запись не найдена", 404);
  return sendTextAndAudit(
    row,
    `Подтверждаем запись: ${appointment.slot.date} в ${appointment.slot.time}.\nАвтомобиль: ${appointment.vin}\nУслуга: ${appointment.comment || "обслуживание"}.`,
    "conversation.send_appointment_link",
    actor,
    { appointmentId: appointment.id }
  );
}

export async function sendShipmentCardFromConversation(conversationId: string, actor?: ContextActor | null) {
  assertOwnerOrAdmin(actor);
  const row = await loadConversationRow(conversationId);
  if (!row) throw new MessengerContextError("Диалог не найден", 404);
  const shipmentId = row.relatedShipmentId;
  if (!shipmentId) throw new MessengerContextError("Сначала создайте или привяжите отгрузку", 409);
  const shipment = await prisma.localDemand.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new MessengerContextError("Отгрузка не найдена", 404);
  return sendTextAndAudit(
    row,
    `Отгрузка ${shipment.name}: ${shipment.applicable ? "проведена" : "черновик"}.\nИтого: ${formatMoney(shipment.sumCents)}.`,
    "conversation.send_shipment_card",
    actor,
    { shipmentId }
  );
}
