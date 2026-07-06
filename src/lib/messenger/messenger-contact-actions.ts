import crypto from "crypto";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import type { User } from "@/lib/auth";
import { getActiveTelegramUserAccount, resolveTelegramUserPeerByPhone } from "./channels/telegram-user-session";
import { sendMessage } from "./messenger-gateway";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationId } from "./messenger-tenant";

export type ContactEntityType =
  | "client"
  | "counterparty"
  | "supplier"
  | "shipment"
  | "appointment"
  | "crm_case"
  | "diagnostic"
  | "precheck";

export type ContactActionContext = {
  entityType?: ContactEntityType | string | null;
  entityId?: string | null;
  shipmentId?: string | null;
  appointmentId?: string | null;
  diagnosticId?: string | null;
  crmCaseId?: string | null;
  reportToken?: string | null;
  precheckId?: string | null;
  car?: string | null;
  plate?: string | null;
  date?: string | null;
  time?: string | null;
  link?: string | null;
  amount?: string | number | null;
};

export type ContactActionInput = {
  entityType?: ContactEntityType | string | null;
  entityId?: string | null;
  counterpartyId?: string | null;
  clientId?: string | null;
  supplierId?: string | null;
  phone?: string | null;
  displayName?: string | null;
  preferredChannel?: "telegram" | string | null;
  context?: ContactActionContext | null;
};

type ContactRow = {
  id: string;
  name: string;
  phone: string | null;
  normalizedPhone: string | null;
  counterpartyTypeName: string | null;
};

type IdentityRow = {
  id: string;
  messengerAccountId: string;
  externalUserId: string;
  externalConversationId: string | null;
  username: string | null;
  displayName: string | null;
  phoneNormalized: string | null;
  clientId: string | null;
  supplierId: string | null;
  status: string;
  matchSource: string;
  linkedAt: Date | null;
};

type ConversationRow = {
  id: string;
  messengerAccountId: string | null;
  externalConversationId: string;
  externalUserId: string | null;
  participantName: string;
  participantPhone: string | null;
  clientId: string | null;
  supplierId: string | null;
  lastMessageAt: Date;
};

export class ContactActionError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "contact_action_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const templateLabels: Record<string, string> = {
  greeting: "Приветствие",
  appointment_confirm: "Подтвердить запись",
  appointment_reminder: "Напомнить о записи",
  shipment_estimate: "Готов расчёт",
  precheck_link: "Отправить предчек",
  diagnostic_report: "Отчёт диагностики",
  parts_waiting: "Ожидание запчастей",
  vehicle_ready: "Автомобиль готов",
};

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function entityTypeForContext(value: string | null | undefined) {
  const raw = cleanText(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === "crm_case") return "CRM_CASE";
  return raw.toUpperCase();
}

function entityTypeForIdentity(input: ContactActionInput, counterparty?: ContactRow | null) {
  const raw = cleanText(input.entityType)?.toLowerCase();
  if (raw === "supplier") return "SUPPLIER";
  if (counterparty?.counterpartyTypeName?.toLowerCase().includes("постав")) return "SUPPLIER";
  return "CLIENT";
}

function actorId(user?: User | null) {
  return user?.login ?? null;
}

function isLinkAdmin(user?: User | null) {
  return user?.role === "owner" || user?.role === "admin";
}

function contactId(input: ContactActionInput) {
  return cleanText(input.counterpartyId) ?? cleanText(input.clientId) ?? cleanText(input.supplierId);
}

function phoneFromInput(input: ContactActionInput, counterparty?: ContactRow | null) {
  return cleanText(input.phone) ?? counterparty?.phone ?? counterparty?.normalizedPhone ?? null;
}

function displayNameFromInput(input: ContactActionInput, counterparty?: ContactRow | null) {
  return cleanText(input.displayName) ?? counterparty?.name ?? "Клиент";
}

function messagesUrl(conversationId: string) {
  return `/messages?conversationId=${encodeURIComponent(conversationId)}`;
}

async function writeAudit(input: {
  organizationId: string;
  messengerAccountId?: string | null;
  actorId?: string | null;
  action: string;
  status?: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.$executeRaw`
    INSERT INTO integration_audit_logs
      (id, organization_id, channel, messenger_account_id, actor_id, action, status, message, metadata_json, created_at)
    VALUES
      (${crypto.randomUUID()}, ${input.organizationId}, 'telegram', ${input.messengerAccountId ?? null},
       ${input.actorId ?? null}, ${input.action}, ${input.status ?? "ok"}, ${input.message ?? null},
       ${JSON.stringify(input.metadata ?? {})}::jsonb, now())
  `;
}

async function loadCounterparty(input: ContactActionInput) {
  const id = contactId(input);
  if (!id) return null;
  return prisma.localCounterparty.findFirst({
    where: { OR: [{ id }, { moyskladId: id }] },
    select: { id: true, name: true, phone: true, normalizedPhone: true, counterpartyTypeName: true },
  });
}

async function findIdentity(organizationId: string, input: ContactActionInput, counterparty?: ContactRow | null) {
  const id = counterparty?.id ?? contactId(input);
  const phone = normalizePhoneKey(phoneFromInput(input, counterparty));
  const rows = await prisma.$queryRaw<IdentityRow[]>`
    SELECT
      id,
      messenger_account_id AS "messengerAccountId",
      external_user_id AS "externalUserId",
      external_conversation_id AS "externalConversationId",
      username,
      display_name AS "displayName",
      phone_normalized AS "phoneNormalized",
      client_id AS "clientId",
      supplier_id AS "supplierId",
      status,
      match_source AS "matchSource",
      linked_at AS "linkedAt"
    FROM communication_identities
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND status <> 'UNLINKED'
      AND (
        (${id}::text IS NOT NULL AND (client_id = ${id} OR supplier_id = ${id}))
        OR (${phone}::text IS NOT NULL AND phone_normalized = ${phone})
      )
    ORDER BY
      CASE WHEN client_id = ${id} OR supplier_id = ${id} THEN 0 ELSE 1 END,
      linked_at DESC NULLS LAST,
      updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findConversation(organizationId: string, input: ContactActionInput, identity?: IdentityRow | null, counterparty?: ContactRow | null) {
  const id = counterparty?.id ?? contactId(input);
  const rows = await prisma.$queryRaw<ConversationRow[]>`
    SELECT
      id,
      messenger_account_id AS "messengerAccountId",
      external_conversation_id AS "externalConversationId",
      external_user_id AS "externalUserId",
      participant_name AS "participantName",
      participant_phone AS "participantPhone",
      client_id AS "clientId",
      supplier_id AS "supplierId",
      last_message_at AS "lastMessageAt"
    FROM messenger_conversations
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND status <> 'archived'
      AND (
        (${id}::text IS NOT NULL AND (client_id = ${id} OR supplier_id = ${id}))
        OR (${identity?.externalConversationId ?? null}::text IS NOT NULL AND external_conversation_id = ${identity?.externalConversationId ?? null})
        OR (${identity?.externalUserId ?? null}::text IS NOT NULL AND external_user_id = ${identity?.externalUserId ?? null})
      )
    ORDER BY last_message_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function assertNoIdentityConflict(input: {
  organizationId: string;
  externalUserId: string;
  messengerAccountId: string;
  clientId?: string | null;
  supplierId?: string | null;
}) {
  const rows = await prisma.$queryRaw<Array<{ id: string; clientId: string | null; supplierId: string | null; displayName: string | null }>>`
    SELECT id, client_id AS "clientId", supplier_id AS "supplierId", display_name AS "displayName"
    FROM communication_identities
    WHERE organization_id = ${input.organizationId}
      AND channel = 'telegram'
      AND messenger_account_id = ${input.messengerAccountId}
      AND external_user_id = ${input.externalUserId}
      AND status <> 'UNLINKED'
      AND (
        (${input.clientId ?? null}::text IS NOT NULL AND client_id IS NOT NULL AND client_id <> ${input.clientId ?? null})
        OR (${input.supplierId ?? null}::text IS NOT NULL AND supplier_id IS NOT NULL AND supplier_id <> ${input.supplierId ?? null})
      )
    LIMIT 1
  `;
  if (rows[0]) {
    throw new ContactActionError("Этот Telegram-диалог уже связан с другим клиентом. Связь не изменена.", 409, "telegram_link_conflict");
  }
}

async function upsertContactIdentity(input: {
  organizationId: string;
  accountId: string;
  externalUserId: string;
  externalConversationId: string;
  username?: string | null;
  displayName: string;
  phoneNormalized: string | null;
  entityType: "CLIENT" | "SUPPLIER";
  clientId?: string | null;
  supplierId?: string | null;
  actorId?: string | null;
  matchSource: string;
}) {
  await prisma.$executeRaw`
    INSERT INTO communication_identities
      (id, organization_id, channel, messenger_account_id, external_user_id, external_conversation_id,
       username, display_name, phone_normalized, entity_type, client_id, supplier_id, status,
       match_source, linked_by_id, linked_at, verified_at, metadata_json, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${input.organizationId}, 'telegram', ${input.accountId}, ${input.externalUserId}, ${input.externalConversationId},
       ${input.username ?? null}, ${input.displayName}, ${input.phoneNormalized}, ${input.entityType},
       ${input.clientId ?? null}, ${input.supplierId ?? null}, 'CONFIRMED', ${input.matchSource},
       ${input.actorId ?? null}, now(), now(), ${JSON.stringify({ source: "contact_action" })}::jsonb, now(), now())
    ON CONFLICT (organization_id, messenger_account_id, external_user_id)
    DO UPDATE SET
      external_conversation_id = EXCLUDED.external_conversation_id,
      username = COALESCE(EXCLUDED.username, communication_identities.username),
      display_name = EXCLUDED.display_name,
      phone_normalized = COALESCE(EXCLUDED.phone_normalized, communication_identities.phone_normalized),
      entity_type = EXCLUDED.entity_type,
      client_id = EXCLUDED.client_id,
      supplier_id = EXCLUDED.supplier_id,
      status = 'CONFIRMED',
      match_source = EXCLUDED.match_source,
      linked_by_id = EXCLUDED.linked_by_id,
      linked_at = COALESCE(communication_identities.linked_at, now()),
      verified_at = now(),
      updated_at = now()
  `;
}

async function linkConversationEntities(input: {
  organizationId: string;
  conversationId: string;
  counterpartyId?: string | null;
  entityType: "CLIENT" | "SUPPLIER";
  context?: ContactActionContext | null;
  actorId?: string | null;
  displayName?: string | null;
}) {
  if (input.counterpartyId) {
    await prisma.$executeRaw`
      INSERT INTO conversation_entity_links
        (id, organization_id, conversation_id, entity_type, entity_id, relation_type, created_by_id, metadata_json, created_at)
      VALUES
        (${crypto.randomUUID()}, ${input.organizationId}, ${input.conversationId}, ${input.entityType}, ${input.counterpartyId},
         'PRIMARY', ${input.actorId ?? null}, ${JSON.stringify({ displayName: input.displayName ?? null })}::jsonb, now())
      ON CONFLICT (organization_id, conversation_id, entity_type, entity_id, relation_type)
      DO UPDATE SET metadata_json = EXCLUDED.metadata_json
    `;
  }
  const contextLinks = [
    ["SHIPMENT", input.context?.shipmentId],
    ["APPOINTMENT", input.context?.appointmentId],
    ["DIAGNOSTIC", input.context?.diagnosticId],
    ["CRM_CASE", input.context?.crmCaseId],
    ["PRECHECK", input.context?.precheckId],
    [entityTypeForContext(input.context?.entityType), input.context?.entityId],
  ] as Array<[string | null, string | null | undefined]>;
  const seen = new Set<string>();
  for (const [type, id] of contextLinks) {
    if (!type || !id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await prisma.$executeRaw`
      INSERT INTO conversation_entity_links
        (id, organization_id, conversation_id, entity_type, entity_id, relation_type, created_by_id, metadata_json, created_at)
      VALUES
        (${crypto.randomUUID()}, ${input.organizationId}, ${input.conversationId}, ${type}, ${id},
         'CONTEXT', ${input.actorId ?? null}, ${JSON.stringify(input.context ?? {})}::jsonb, now())
      ON CONFLICT (organization_id, conversation_id, entity_type, entity_id, relation_type)
      DO UPDATE SET metadata_json = EXCLUDED.metadata_json
    `;
  }
}

export function renderContactTemplate(templateKey: string, vars: Record<string, unknown>) {
  const clientName = cleanText(vars.clientName) ?? cleanText(vars.displayName) ?? "клиент";
  const car = cleanText(vars.car) ?? cleanText(vars.vehicle);
  const date = cleanText(vars.date) ?? "{date}";
  const time = cleanText(vars.time) ?? "{time}";
  const link = cleanText(vars.link) ?? cleanText(vars.reportUrl) ?? cleanText(vars.precheckUrl) ?? "{link}";
  const vehicleSuffix = car ? ` по автомобилю ${car}` : "";
  const templates: Record<string, string> = {
    greeting: `Здравствуйте, ${clientName}! Это "Там где масло".`,
    appointment_confirm: `Здравствуйте, ${clientName}! Подтвердите, пожалуйста, запись на ${date} в ${time}.`,
    appointment_reminder: `Здравствуйте, ${clientName}! Напоминаем, что вы записаны на ${date} в ${time}.`,
    shipment_estimate: `Здравствуйте, ${clientName}! Подготовили расчёт${vehicleSuffix}.`,
    precheck_link: `Здравствуйте, ${clientName}! Отправляем предчек${vehicleSuffix}: ${link}`,
    diagnostic_report: `Здравствуйте, ${clientName}! Отправляем отчёт диагностики${vehicleSuffix}: ${link}`,
    parts_waiting: `Здравствуйте, ${clientName}! Запчасти заказаны, ожидаем поставку. Как только всё придёт - напишем.`,
    vehicle_ready: `Здравствуйте, ${clientName}! Автомобиль готов, можно забирать.`,
  };
  return templates[templateKey] ?? templates.greeting;
}

export function listContactTemplates() {
  return Object.entries(templateLabels).map(([key, label]) => ({ key, label }));
}

export async function getContactStatus(input: ContactActionInput) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const counterparty = await loadCounterparty(input);
  const phone = phoneFromInput(input, counterparty);
  const normalizedPhone = normalizePhoneKey(phone);
  const account = await getActiveTelegramUserAccount().catch(() => null);
  const telegramConnected = Boolean(account?.isActive && account.status === "connected");
  const identity = await findIdentity(organizationId, input, counterparty);
  const conversation = await findConversation(organizationId, input, identity, counterparty);
  const hasPhone = Boolean(normalizedPhone);
  const telegramLinked = Boolean(identity || conversation);
  const reasonIfUnavailable = !telegramConnected
    ? "telegram_not_connected"
    : !telegramLinked && !hasPhone
      ? "phone_missing"
      : null;
  return {
    hasPhone,
    phone: phone ?? null,
    phoneNormalized: normalizedPhone,
    displayName: displayNameFromInput(input, counterparty),
    telegramConnected,
    telegramLinked,
    canMessage: telegramConnected && (telegramLinked || hasPhone),
    canOpenConversation: Boolean(conversation),
    lastConversationId: conversation?.id ?? null,
    conversationUrl: conversation?.id ? messagesUrl(conversation.id) : null,
    reasonIfUnavailable,
    identity: identity
      ? {
          id: identity.id,
          displayName: identity.displayName,
          username: identity.username,
          linkedAt: identity.linkedAt?.toISOString() ?? null,
          matchSource: identity.matchSource,
        }
      : null,
    templates: listContactTemplates(),
  };
}

export async function startContactConversation(input: ContactActionInput, actor?: User | null) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const counterparty = await loadCounterparty(input);
  const id = counterparty?.id ?? contactId(input);
  const entityType = entityTypeForIdentity(input, counterparty);
  const clientId = entityType === "CLIENT" ? id : null;
  const supplierId = entityType === "SUPPLIER" ? id : null;
  const displayName = displayNameFromInput(input, counterparty);
  const phone = phoneFromInput(input, counterparty);
  const normalizedPhone = normalizePhoneKey(phone);
  const identity = await findIdentity(organizationId, input, counterparty);
  const existing = await findConversation(organizationId, input, identity, counterparty);
  if (existing) {
    await linkConversationEntities({
      organizationId,
      conversationId: existing.id,
      counterpartyId: id,
      entityType,
      context: input.context,
      actorId: actorId(actor),
      displayName,
    });
    return {
      ok: true as const,
      conversationId: existing.id,
      conversationUrl: messagesUrl(existing.id),
      status: await getContactStatus(input),
      created: false,
    };
  }
  if (!normalizedPhone) throw new ContactActionError("У клиента нет телефона. Добавьте телефон, чтобы написать в Telegram.", 400, "phone_missing");

  const resolved = await resolveTelegramUserPeerByPhone(phone ?? normalizedPhone);
  if ("ok" in resolved) {
    throw new ContactActionError(resolved.message, resolved.reason === "telegram_not_connected" ? 409 : 400, resolved.reason);
  }
  await assertNoIdentityConflict({
    organizationId,
    externalUserId: resolved.externalUserId,
    messengerAccountId: resolved.accountId,
    clientId,
    supplierId,
  });
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET client_id = ${clientId},
        supplier_id = ${supplierId},
        participant_phone = COALESCE(participant_phone, ${phone ?? normalizedPhone}),
        status = 'open',
        updated_at = now()
    WHERE id = ${resolved.conversationId}
      AND organization_id = ${organizationId}
  `;
  await upsertContactIdentity({
    organizationId,
    accountId: resolved.accountId,
    externalUserId: resolved.externalUserId,
    externalConversationId: resolved.externalConversationId,
    username: resolved.username,
    displayName: resolved.displayName,
    phoneNormalized: normalizedPhone,
    entityType,
    clientId,
    supplierId,
    actorId: actorId(actor),
    matchSource: resolved.source === "imported_contact" ? "IMPORTED_CONTACT" : "PHONE_LOOKUP",
  });
  await linkConversationEntities({
    organizationId,
    conversationId: resolved.conversationId,
    counterpartyId: id,
    entityType,
    context: input.context,
    actorId: actorId(actor),
    displayName,
  });
  await writeAudit({
    organizationId,
    messengerAccountId: resolved.accountId,
    actorId: actorId(actor),
    action: "contact.start_conversation",
    metadata: { counterpartyId: id, entityType, context: input.context, source: resolved.source },
  });
  return {
    ok: true as const,
    conversationId: resolved.conversationId,
    conversationUrl: messagesUrl(resolved.conversationId),
    status: await getContactStatus(input),
    created: true,
  };
}

export async function sendContactMessage(
  input: ContactActionInput & { conversationId?: string | null; text?: string | null; templateKey?: string | null; templateVars?: Record<string, unknown> | null },
  actor?: User | null
) {
  const text =
    cleanText(input.text) ??
    (input.templateKey ? renderContactTemplate(input.templateKey, { ...(input.templateVars ?? {}), clientName: input.displayName }) : null);
  if (!text) throw new ContactActionError("Введите текст сообщения", 400, "message_empty");
  const start = input.conversationId
    ? { conversationId: input.conversationId, conversationUrl: messagesUrl(input.conversationId), created: false }
    : await startContactConversation(input, actor);
  const result = await sendMessage({
    conversationId: start.conversationId,
    text,
    createdByLogin: actor?.login,
  });
  const organizationId = getMessengerOrganizationId();
  await writeAudit({
    organizationId,
    actorId: actorId(actor),
    action: input.templateKey ? "contact.send_template" : start.created ? "contact.send_first_message" : "contact.send_message",
    status: result?.ok ? "ok" : "error",
    message: result?.error ?? null,
    metadata: { conversationId: start.conversationId, templateKey: input.templateKey ?? null, context: input.context ?? null },
  });
  if (!result) throw new ContactActionError("Диалог не найден", 404, "conversation_not_found");
  if (!result.ok) {
    const error = result.error || "Telegram не разрешил отправить сообщение.";
    const lower = error.toLowerCase();
    const code = lower.includes("flood")
      ? "flood_wait"
      : lower.includes("privacy") || lower.includes("private")
        ? "privacy_restricted"
        : "telegram_send_failed";
    throw new ContactActionError(
      code === "privacy_restricted"
        ? "Telegram не разрешил написать этому пользователю. Возможны настройки приватности или ограничения Telegram."
        : error,
      400,
      code
    );
  }
  return {
    ok: true as const,
    conversationId: start.conversationId,
    conversationUrl: start.conversationUrl,
    message: result.message,
  };
}

export async function linkContactContext(input: ContactActionInput & { conversationId: string }, actor?: User | null) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const counterparty = await loadCounterparty(input);
  const id = counterparty?.id ?? contactId(input);
  const entityType = entityTypeForIdentity(input, counterparty);
  await linkConversationEntities({
    organizationId,
    conversationId: input.conversationId,
    counterpartyId: id,
    entityType,
    context: input.context,
    actorId: actorId(actor),
    displayName: displayNameFromInput(input, counterparty),
  });
  await writeAudit({
    organizationId,
    actorId: actorId(actor),
    action: "contact.link_context",
    metadata: { conversationId: input.conversationId, counterpartyId: id, context: input.context },
  });
  return { ok: true as const };
}

export async function linkContactManually(input: ContactActionInput & { conversationId: string }, actor?: User | null) {
  if (!isLinkAdmin(actor)) throw new ContactActionError("Недостаточно прав для привязки Telegram к клиенту", 403, "forbidden");
  return linkContactContext(input, actor);
}
