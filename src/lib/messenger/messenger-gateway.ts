import crypto from "crypto";
import { touchClientCaseMessageState } from "@/lib/client-case-workflow";
import { prisma } from "@/lib/db";
import { assertTelegramWebhookSecret, getTelegramUpdates, telegramChannelAdapter } from "./channels/telegram";
import {
  getTelegramUserRuntimeConfig,
  syncTelegramUserAccount,
  telegramUserSessionAdapter,
} from "./channels/telegram-user-session";
import { mockChannelAdapter, mockGatewayConversations, mockGatewayMessages } from "./channels/mock";
import { plannedChannelAdapters } from "./channels/planned";
import { linkTelegramClientFromStartToken, linkTelegramEmployeeFromStartToken } from "./messenger-linking";
import { enqueueMessageOutbox, processOutboxItem } from "./messenger-outbox";
import { listMessageTemplates } from "./messenger-templates";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { assertMessengerOutboundTextSafe } from "./messenger-security";
import { getMessengerOrganizationId } from "./messenger-tenant";
import { normalizeAttachmentList } from "./messenger-attachment-normalization";
import type {
  Conversation,
  IncomingMessageEvent,
  Message,
  MessengerChannel,
  MessengerChannelDefinition,
  MessengerConnection,
  MessengerListParams,
  SendMessageInput,
  SendMessageResult,
} from "./messenger-types";
import { messengerChannelCatalog, messengerChannels } from "./messenger-types";

type ConversationRow = {
  id: string;
  organizationId: string;
  messengerAccountId: string | null;
  channel: MessengerChannel;
  externalConversationId: string;
  title: string;
  participantName: string;
  participantPhone: string | null;
  participantAvatarUrl: string | null;
  lastMessageText: string;
  lastMessageAt: Date;
  unreadCount: number;
  isPinned: boolean;
  isImportant: boolean;
  status: string;
  clientId: string | null;
  employeeId: string | null;
  supplierId: string | null;
  assignedToId: string | null;
  relatedCaseId: string | null;
  relatedAppointmentId: string | null;
  relatedShipmentId: string | null;
  relatedDiagnosticId: string | null;
};

type MessageRow = {
  id: string;
  organizationId: string;
  conversationId: string;
  messengerAccountId: string | null;
  channel: MessengerChannel;
  externalMessageId: string | null;
  direction: Message["direction"];
  authorType: Message["authorType"];
  authorId: string | null;
  text: string;
  attachmentsJson: Message["attachments"];
  createdAt: Date;
  status: Message["status"];
  errorCode: string | null;
  errorMessage: string | null;
};

type TelegramUserRuntimeConfig = {
  mode?: string;
  enabled?: boolean;
  configured?: boolean;
  connectionStatus?: MessengerConnection["connectionStatus"];
  account?: {
    displayName?: string | null;
    username?: string | null;
    phone?: string | null;
  } | null;
};

const plannedChannels = ["whatsapp", "vk", "instagram", "avito", "max", "website", "sms", "email"] as const;
type PlannedChannel = (typeof plannedChannels)[number];

function isPlannedChannel(channel: MessengerChannel): channel is PlannedChannel {
  return (plannedChannels as readonly MessengerChannel[]).includes(channel);
}

function normalizeLimit(value: number | undefined, fallback = 50) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(value ?? fallback)));
}

function normalizeOffset(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value ?? 0));
}

function sanitizeMessengerText(value: string) {
  return /^\s*\[Вложение Telegram\]\s*$/i.test(value) ? "Вложение" : value;
}

function telegramVarsFromSendInput(input: SendMessageInput) {
  const buttonText = input.linkButton?.text.trim();
  const buttonUrl = input.linkButton?.url.trim();
  const textLinks = (input.textLinks ?? []).filter((link) => Number.isFinite(link.offset) && Number.isFinite(link.length) && link.length > 0 && /^https?:\/\//iu.test(link.url));
  const boldRanges = (input.boldRanges ?? []).filter((range) => Number.isFinite(range.offset) && Number.isFinite(range.length) && range.length > 0);
  const hasFormatting = textLinks.length > 0 || boldRanges.length > 0;
  if (!buttonText || !buttonUrl) {
    return input.disableWebPagePreview === undefined && !hasFormatting
      ? undefined
      : { telegram: { disableWebPagePreview: input.disableWebPagePreview, textLinks, boldRanges } };
  }
  return {
    telegram: {
      disableWebPagePreview: input.disableWebPagePreview ?? true,
      buttons: [{ text: buttonText, url: buttonUrl }],
      textLinks,
      boldRanges,
    },
  };
}

function sendTextWithLinkFallback(text: string, input: SendMessageInput, inlineButtonsSupported: boolean) {
  const buttonText = input.linkButton?.text.trim();
  const buttonUrl = input.linkButton?.url.trim();
  const hasTextLink = (input.textLinks ?? []).some((link) => link.url === buttonUrl);
  if (hasTextLink) return text;
  if (inlineButtonsSupported || !buttonText || !buttonUrl || text.includes(buttonUrl)) return text;
  return `${text}\n\n${buttonText}: ${buttonUrl}`;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    messengerAccountId: row.messengerAccountId,
    channel: row.channel,
    externalConversationId: row.externalConversationId,
    title: row.title,
    participantName: row.participantName,
    participantPhone: row.participantPhone ?? undefined,
    participantAvatar: row.participantAvatarUrl ?? undefined,
    lastMessageText: sanitizeMessengerText(row.lastMessageText),
    lastMessageAt: row.lastMessageAt.toISOString(),
    unreadCount: row.unreadCount,
    isPinned: row.isPinned,
    isImportant: row.isImportant,
    status: row.status === "archived" || row.status === "blocked" ? row.status : "open",
    kind: row.clientId ? "client" : row.employeeId ? "employee" : row.supplierId ? "supplier" : "unknown",
    clientId: row.clientId ?? undefined,
    appointmentId: row.relatedAppointmentId ?? undefined,
    shipmentId: row.relatedShipmentId ?? undefined,
    caseId: row.relatedCaseId ?? undefined,
    diagnosticId: row.relatedDiagnosticId ?? undefined,
    assignedTo: row.assignedToId ?? undefined,
    tags: [],
    hasOverdueCase: false,
  };
}

function toMessage(row: MessageRow): Message {
  const attachments = normalizeAttachmentList(row.attachmentsJson ?? []);
  return {
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    messengerAccountId: row.messengerAccountId,
    channel: row.channel,
    direction: row.direction,
    authorName: row.authorId ?? (row.authorType === "employee" ? "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ" : row.authorType === "system" ? "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ" : "Клиент"),
    authorType: row.authorType,
    text: /^\s*\[Вложение Telegram\]\s*$/i.test(row.text) ? "" : row.text,
    attachments,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    channelMessageId: row.externalMessageId ?? undefined,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}

function mockConversationById(id: string) {
  return mockGatewayConversations.find((conversation) => conversation.id === id) ?? null;
}

async function messengerAccountIdForConversation(conversationId: string) {
  const rows = await prisma.$queryRaw<Array<{ messengerAccountId: string | null }>>`
    SELECT messenger_account_id AS "messengerAccountId"
    FROM messenger_conversations
    WHERE id = ${conversationId}
      AND organization_id = ${getMessengerOrganizationId()}
    LIMIT 1
  `;
  return rows[0]?.messengerAccountId ?? null;
}

async function messengerAccountMode(accountId: string | null | undefined) {
  if (!accountId) return null;
  const rows = await prisma.$queryRaw<Array<{ mode: string | null }>>`
    SELECT mode
    FROM messenger_accounts
    WHERE id = ${accountId}
      AND organization_id = ${getMessengerOrganizationId()}
    LIMIT 1
  `;
  return rows[0]?.mode ?? null;
}

export async function listMessengerConnections(): Promise<MessengerConnection[]> {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const telegramBase = telegramUserSessionAdapter.getConnection();
  const telegramConfig: TelegramUserRuntimeConfig = await getTelegramUserRuntimeConfig().catch(() => telegramBase.config ?? {});
  const telegramStatus =
    typeof telegramConfig.connectionStatus === "string"
      ? (telegramConfig.connectionStatus as MessengerConnection["connectionStatus"])
      : telegramBase.connectionStatus;
  const telegram = {
    ...telegramBase,
    displayName: telegramConfig.account?.displayName ?? telegramBase.displayName,
    externalUsername: telegramConfig.account?.username ?? telegramBase.externalUsername,
    phone: telegramConfig.account?.phone ?? telegramBase.phone,
    isActive: telegramStatus === "connected",
    connectionStatus: telegramStatus,
    rawJson: telegramConfig,
    config: telegramConfig,
  };
  const mock = mockChannelAdapter.getConnection();
  const configured: MessengerConnection[] = [
    telegram,
    mock,
    ...plannedChannels.map((channel) => plannedChannelAdapters[channel].getConnection()),
  ];
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        channel: MessengerChannel;
        type: MessengerConnection["type"];
        clientId: string | null;
        employeeId: string | null;
        supplierId: string | null;
        externalUserId: string | null;
        externalChatId: string;
        externalUsername: string | null;
        displayName: string;
        phone: string | null;
        avatarUrl: string | null;
        isActive: boolean;
        linkedAt: Date | null;
        lastSeenAt: Date | null;
        blockedAt: Date | null;
        rawJson: Record<string, unknown> | null;
      }>
    >`
      SELECT
        id,
        channel,
        type,
        client_id AS "clientId",
        employee_id AS "employeeId",
        supplier_id AS "supplierId",
        external_user_id AS "externalUserId",
        external_chat_id AS "externalChatId",
        external_username AS "externalUsername",
        display_name AS "displayName",
        phone,
        avatar_url AS "avatarUrl",
        is_active AS "isActive",
        linked_at AS "linkedAt",
        last_seen_at AS "lastSeenAt",
        blocked_at AS "blockedAt",
        raw_json AS "rawJson"
      FROM messenger_connections
      WHERE organization_id = ${organizationId}
    `;
    const byChannel = new Map(configured.map((item) => [item.channel, item]));
    for (const row of rows) {
      if (!messengerChannels.includes(row.channel)) continue;
      if (isPlannedChannel(row.channel)) continue;
      byChannel.set(row.channel, {
        ...row,
        connectionStatus: row.channel === "telegram" ? telegram.connectionStatus : row.isActive ? "connected" : "not_connected",
        label: messengerChannelCatalog[row.channel].label,
        config: row.channel === "telegram" ? telegram.config : row.rawJson,
        linkedAt: row.linkedAt?.toISOString() ?? null,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        blockedAt: row.blockedAt?.toISOString() ?? null,
      });
    }
    return messengerChannels.map((channel) => byChannel.get(channel)).filter((item): item is MessengerConnection => Boolean(item));
  } catch {
    return configured;
  }
}

export async function listMessengerChannels(): Promise<MessengerChannelDefinition[]> {
  const connections = await listMessengerConnections();
  const byChannel = new Map(connections.map((connection) => [connection.channel, connection]));
  return messengerChannels.map((channel) => {
    const connection = byChannel.get(channel);
    const isTelegram = channel === "telegram";
    const isMock = channel === "mock";
    return {
      ...messengerChannelCatalog[channel],
      enabled: isTelegram || isMock,
      connectionStatus: connection?.connectionStatus ?? "disabled",
      adapterStatus: isTelegram ? "real" : isMock ? "test" : "planned",
      connection,
    };
  });
}

export async function listConversations(params: MessengerListParams = {}) {
  await ensureMessengerIntegrationCoreSchema();
  const limit = normalizeLimit(params.limit);
  const offset = normalizeOffset(params.offset);
  const search = params.search?.trim() ?? "";
  const channel = params.channel && params.channel !== "all" ? params.channel : null;
  const clientId = params.clientId?.trim() || null;
  const assignedTo = params.assignedTo?.trim() || null;
  const organizationId = getMessengerOrganizationId();
  try {
    const rows = await prisma.$queryRaw<ConversationRow[]>`
      SELECT
        id,
        organization_id AS "organizationId",
        messenger_account_id AS "messengerAccountId",
        channel,
        external_conversation_id AS "externalConversationId",
        title,
        participant_name AS "participantName",
        participant_phone AS "participantPhone",
        participant_avatar_url AS "participantAvatarUrl",
        last_message_text AS "lastMessageText",
        last_message_at AS "lastMessageAt",
        unread_count AS "unreadCount",
        is_pinned AS "isPinned",
        is_important AS "isImportant",
        status,
        client_id AS "clientId",
        employee_id AS "employeeId",
        supplier_id AS "supplierId",
        assigned_to_id AS "assignedToId",
        related_case_id AS "relatedCaseId",
        related_appointment_id AS "relatedAppointmentId",
        related_shipment_id AS "relatedShipmentId",
        related_diagnostic_id AS "relatedDiagnosticId"
      FROM messenger_conversations
      WHERE
        organization_id = ${organizationId}
        AND
        (${channel}::text IS NULL OR channel = ${channel})
        AND status <> 'archived'
        AND (
          channel <> 'telegram'
          OR EXISTS (
            SELECT 1
            FROM messenger_accounts ma
            WHERE ma.id = messenger_conversations.messenger_account_id
              AND ma.organization_id = ${organizationId}
              AND ma.channel = 'telegram'
              AND ma.mode = 'user_session'
              AND ma.is_active = true
              AND ma.status = 'connected'
          )
        )
        AND (${clientId}::text IS NULL OR client_id = ${clientId})
        AND (${assignedTo}::text IS NULL OR assigned_to_id = ${assignedTo})
        AND (${search}::text = '' OR (
          title ILIKE '%' || ${search} || '%'
          OR participant_name ILIKE '%' || ${search} || '%'
          OR COALESCE(participant_phone, '') ILIKE '%' || ${search} || '%'
          OR last_message_text ILIKE '%' || ${search} || '%'
          OR COALESCE(related_case_id, '') ILIKE '%' || ${search} || '%'
          OR COALESCE(related_shipment_id, '') ILIKE '%' || ${search} || '%'
        ))
        AND (${params.filter ?? "all"}::text <> 'unread' OR unread_count > 0)
        AND (${params.filter ?? "all"}::text <> 'important' OR is_important = true OR is_pinned = true)
        AND (${params.filter ?? "all"}::text <> 'clients' OR client_id IS NOT NULL)
        AND (${params.filter ?? "all"}::text <> 'suppliers' OR supplier_id IS NOT NULL)
        AND (${params.filter ?? "all"}::text <> 'employees' OR employee_id IS NOT NULL)
        AND (${params.filter ?? "all"}::text <> 'withoutClient' OR client_id IS NULL)
        AND (${params.filter ?? "all"}::text <> 'openCases' OR (related_case_id IS NOT NULL AND status = 'open'))
      ORDER BY is_pinned DESC, last_message_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return rows.map(toConversation);
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not exist")) return [];
    throw error;
  }
}

export async function getConversation(id: string): Promise<Conversation | null> {
  await ensureMessengerIntegrationCoreSchema();
  const mock = mockConversationById(id);
  if (mock) return mock;
  const organizationId = getMessengerOrganizationId();
	  const rows = await prisma.$queryRaw<ConversationRow[]>`
	    SELECT
	      id,
	      organization_id AS "organizationId",
	      messenger_account_id AS "messengerAccountId",
	      channel,
      external_conversation_id AS "externalConversationId",
      title,
      participant_name AS "participantName",
      participant_phone AS "participantPhone",
      participant_avatar_url AS "participantAvatarUrl",
      last_message_text AS "lastMessageText",
      last_message_at AS "lastMessageAt",
      unread_count AS "unreadCount",
      is_pinned AS "isPinned",
      is_important AS "isImportant",
      status,
      client_id AS "clientId",
      employee_id AS "employeeId",
      supplier_id AS "supplierId",
      assigned_to_id AS "assignedToId",
      related_case_id AS "relatedCaseId",
      related_appointment_id AS "relatedAppointmentId",
      related_shipment_id AS "relatedShipmentId",
      related_diagnostic_id AS "relatedDiagnosticId"
    FROM messenger_conversations
    WHERE id = ${id}
      AND organization_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ? toConversation(rows[0]) : null;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  await ensureMessengerIntegrationCoreSchema();
  if (mockGatewayMessages[conversationId]) return mockGatewayMessages[conversationId];
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<MessageRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      conversation_id AS "conversationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      external_message_id AS "externalMessageId",
      direction,
      author_type AS "authorType",
      author_id AS "authorId",
      text,
      attachments_json AS "attachmentsJson",
      created_at AS "createdAt",
      status,
      error_code AS "errorCode",
      error_message AS "errorMessage"
    FROM messenger_messages
    WHERE conversation_id = ${conversationId}
      AND organization_id = ${organizationId}
    ORDER BY created_at ASC
    LIMIT 500
  `;
  return rows.map(toMessage);
}

export async function markConversationRead(conversationId: string) {
  await ensureMessengerIntegrationCoreSchema();
  if (mockConversationById(conversationId)) return { ok: true };
  const organizationId = getMessengerOrganizationId();
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET unread_count = 0, status = 'open', updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${organizationId}
  `;
  return { ok: true };
}

export async function archiveConversation(conversationId: string, archived = true) {
  await ensureMessengerIntegrationCoreSchema();
  const mock = mockConversationById(conversationId);
  if (mock) return { ...mock, status: archived ? "archived" as const : "open" as const };
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET status = ${archived ? "archived" : "open"},
        updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${getMessengerOrganizationId()}
  `;
  return getConversation(conversationId);
}

export async function setConversationPinned(conversationId: string, pinned?: boolean) {
  await ensureMessengerIntegrationCoreSchema();
  const mock = mockConversationById(conversationId);
  if (mock) return { ...mock, isPinned: pinned ?? !mock.isPinned };
  const current = await getConversation(conversationId);
  if (!current) return null;
  const next = pinned ?? !current.isPinned;
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET is_pinned = ${next},
        updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${getMessengerOrganizationId()}
  `;
  return getConversation(conversationId);
}

export async function setConversationImportant(conversationId: string, important?: boolean) {
  await ensureMessengerIntegrationCoreSchema();
  const mock = mockConversationById(conversationId);
  if (mock) return { ...mock, isImportant: important ?? !mock.isImportant };
  const current = await getConversation(conversationId);
  if (!current) return null;
  const next = important ?? !current.isImportant;
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET is_important = ${next},
        updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${getMessengerOrganizationId()}
  `;
  return getConversation(conversationId);
}

export async function linkConversationClient(conversationId: string, clientId: string) {
  await ensureMessengerIntegrationCoreSchema();
  const mock = mockConversationById(conversationId);
  if (mock) return { ...mock, clientId, kind: "client" as const };
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET client_id = ${clientId},
        employee_id = NULL,
        supplier_id = NULL,
        updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${getMessengerOrganizationId()}
  `;
  return getConversation(conversationId);
}

export async function unlinkConversationClient(conversationId: string) {
  await ensureMessengerIntegrationCoreSchema();
  const mock = mockConversationById(conversationId);
  if (mock) return { ...mock, clientId: undefined, kind: "unknown" as const };
  const organizationId = getMessengerOrganizationId();
  const conversation = await getConversation(conversationId);
  if (!conversation) return null;
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET client_id = NULL,
        updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${organizationId}
  `;
  const messageId = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO messenger_messages
      (id, organization_id, conversation_id, messenger_account_id, channel, direction, author_type, text, attachments_json, status, created_at, updated_at)
    VALUES
      (${messageId}, ${organizationId}, ${conversationId}, ${conversation.messengerAccountId ?? null}, ${conversation.channel}, 'system', 'system',
       ${"Клиент отвязан от диалога. Переписка и связанные документы сохранены."}, '[]'::jsonb, 'read', now(), now())
  `;
  return getConversation(conversationId);
}

export async function createCaseFromConversation(conversationId: string, input: { title?: string; createdByLogin: string }) {
  await ensureMessengerIntegrationCoreSchema();
  const conversation = await getConversation(conversationId);
  if (!conversation) return null;
  const messageId = crypto.randomUUID();
  const caseId = `case-${crypto.randomUUID()}`;
  if (mockConversationById(conversationId)) {
    return { id: caseId, conversationId, title: input.title || conversation.title };
  }
  const organizationId = getMessengerOrganizationId();
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET related_case_id = COALESCE(related_case_id, ${caseId}), status = 'open', updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${organizationId}
  `;
  await prisma.$executeRaw`
    INSERT INTO messenger_messages
      (id, organization_id, conversation_id, messenger_account_id, channel, direction, author_type, text, attachments_json, status, created_at, updated_at)
    VALUES
      (${messageId}, ${organizationId}, ${conversationId}, ${conversation.messengerAccountId ?? null}, ${conversation.channel}, 'system', 'system',
       ${`Создано дело клиента: ${input.title || conversation.title}`}, '[]'::jsonb, 'read', now(), now())
  `;
  return { id: caseId, conversationId, title: input.title || conversation.title };
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult | null> {
  await ensureMessengerIntegrationCoreSchema();
  const conversation = await getConversation(input.conversationId);
  if (!conversation) return null;
  if (mockConversationById(input.conversationId)) {
    const message: Message = {
      id: `mock-out-${Date.now()}`,
      conversationId: input.conversationId,
      channel: conversation.channel,
      direction: "outbound",
      authorName: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
      authorType: "employee",
      text: input.text,
      attachments: [],
      createdAt: new Date().toISOString(),
      status: "sent",
      replyToId: input.replyToId,
    };
    return { ok: true, message };
  }

  const messageId = crypto.randomUUID();
  const text = input.text.trim();
  assertMessengerOutboundTextSafe(text);
  const organizationId = conversation.organizationId ?? getMessengerOrganizationId();
  if (input.idempotencyKey) {
    const existing = await prisma.messengerOutbox.findFirst({
      where: { organizationId, idempotencyKey: input.idempotencyKey },
      include: { message: true },
    });
    if (existing?.message) {
      return { ok: existing.status !== "failed", message: toMessage(existing.message as unknown as MessageRow), outbox: existing as unknown as import("./messenger-types").MessageOutbox, error: existing.errorMessage ?? undefined };
    }
  }
  const messengerAccountId =
    conversation.messengerAccountId ?? (conversation.channel === "telegram" ? await messengerAccountIdForConversation(conversation.id) : null);
  const inlineButtonsSupported = conversation.channel === "telegram" && (await messengerAccountMode(messengerAccountId)) === "bot_legacy";
  const textForSend = sendTextWithLinkFallback(text, input, inlineButtonsSupported);
  assertMessengerOutboundTextSafe(textForSend);
  const templateVarsJson = inlineButtonsSupported
    ? telegramVarsFromSendInput(input)
    : telegramVarsFromSendInput({ ...input, linkButton: undefined });
  const rows = await prisma.$queryRaw<MessageRow[]>`
    INSERT INTO messenger_messages
      (id, organization_id, conversation_id, messenger_account_id, channel, direction, author_type, text, attachments_json, status, created_at, updated_at)
    VALUES
      (${messageId}, ${organizationId}, ${conversation.id}, ${messengerAccountId}, ${conversation.channel}, 'outbound', 'employee',
       ${textForSend}, '[]'::jsonb, 'queued', now(), now())
    RETURNING
      id,
      organization_id AS "organizationId",
      conversation_id AS "conversationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      external_message_id AS "externalMessageId",
      direction,
      author_type AS "authorType",
      author_id AS "authorId",
      text,
      attachments_json AS "attachmentsJson",
      created_at AS "createdAt",
      status,
      error_code AS "errorCode",
      error_message AS "errorMessage"
  `;
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET last_message_text = ${textForSend}, last_message_at = now(), status = 'open', unread_count = 0, updated_at = now()
    WHERE id = ${conversation.id}
      AND organization_id = ${organizationId}
  `;
  const outbox = await enqueueMessageOutbox({
    organizationId,
    conversationId: conversation.id,
    messageId,
    channel: conversation.channel,
    recipientExternalChatId: conversation.externalConversationId,
    messengerAccountId,
    text: textForSend,
    templateVarsJson,
    idempotencyKey: input.idempotencyKey,
  });
  const processed = await processOutboxItem(outbox);
  await touchClientCaseMessageState({
    conversationId: conversation.id,
    direction: "outbound",
    at: new Date(),
    text: textForSend,
  }).catch((error) => console.warn("[messenger send] client case touch failed", error));
  const refreshed = (await listMessages(conversation.id)).find((message) => message.id === messageId) ?? toMessage(rows[0]);
  return { ok: processed.status !== "failed", message: refreshed, outbox: processed, error: processed.errorMessage ?? undefined };
}

async function upsertConnectionFromIncoming(event: IncomingMessageEvent) {
  await ensureMessengerIntegrationCoreSchema();
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO messenger_connections
      (id, organization_id, channel, type, external_user_id, external_chat_id, display_name, avatar_url, is_active, last_seen_at, raw_json, updated_at)
    VALUES
      (${id}, ${organizationId}, ${event.channel}, 'unknown', ${event.externalUserId ?? null}, ${event.externalConversationId},
       ${event.participantName}, ${event.participantAvatar ?? null}, true, ${event.createdAt}, ${JSON.stringify(event.raw)}::jsonb, now())
    ON CONFLICT (channel, external_chat_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      external_user_id = COALESCE(EXCLUDED.external_user_id, messenger_connections.external_user_id),
      display_name = EXCLUDED.display_name,
      avatar_url = COALESCE(EXCLUDED.avatar_url, messenger_connections.avatar_url),
      is_active = messenger_connections.is_active,
      last_seen_at = EXCLUDED.last_seen_at,
      raw_json = EXCLUDED.raw_json,
      updated_at = now()
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

async function upsertConversationFromIncoming(event: IncomingMessageEvent): Promise<Conversation> {
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const connectionId = await upsertConnectionFromIncoming(event);
  const rows = await prisma.$queryRaw<ConversationRow[]>`
    INSERT INTO messenger_conversations
      (id, organization_id, channel, external_conversation_id, connection_id, title, participant_name, participant_avatar_url,
       last_message_text, last_message_at, unread_count, status, updated_at)
    VALUES
      (${id}, ${organizationId}, ${event.channel}, ${event.externalConversationId}, ${connectionId},
       ${event.participantName}, ${event.participantName}, ${event.participantAvatar ?? null},
       ${event.text}, ${event.createdAt}, 1, 'open', now())
    ON CONFLICT (channel, external_conversation_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      connection_id = COALESCE(EXCLUDED.connection_id, messenger_conversations.connection_id),
      participant_name = EXCLUDED.participant_name,
      participant_avatar_url = COALESCE(EXCLUDED.participant_avatar_url, messenger_conversations.participant_avatar_url),
      last_message_text = EXCLUDED.last_message_text,
      last_message_at = EXCLUDED.last_message_at,
      unread_count = messenger_conversations.unread_count + 1,
      status = 'open',
      updated_at = now()
    RETURNING
      id,
      organization_id AS "organizationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      external_conversation_id AS "externalConversationId",
      title,
      participant_name AS "participantName",
      participant_phone AS "participantPhone",
      participant_avatar_url AS "participantAvatarUrl",
      last_message_text AS "lastMessageText",
      last_message_at AS "lastMessageAt",
      unread_count AS "unreadCount",
      is_pinned AS "isPinned",
      is_important AS "isImportant",
      status,
      client_id AS "clientId",
      employee_id AS "employeeId",
      supplier_id AS "supplierId",
      assigned_to_id AS "assignedToId",
      related_case_id AS "relatedCaseId",
      related_appointment_id AS "relatedAppointmentId",
      related_shipment_id AS "relatedShipmentId",
      related_diagnostic_id AS "relatedDiagnosticId"
  `;
  return toConversation(rows[0]);
}

async function insertIncomingMessage(conversation: Conversation, event: IncomingMessageEvent) {
  const id = crypto.randomUUID();
  const organizationId = conversation.organizationId ?? getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<MessageRow[]>`
    INSERT INTO messenger_messages
      (id, organization_id, conversation_id, messenger_account_id, channel, external_message_id, direction, author_type, author_id, text, attachments_json, status, raw_json, received_at, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, ${conversation.id}, ${conversation.messengerAccountId ?? null}, ${event.channel}, ${event.channelMessageId ?? null}, 'inbound',
       'client', ${event.participantName}, ${event.text}, '[]'::jsonb, 'delivered', ${JSON.stringify(event.raw)}::jsonb, ${event.createdAt}, ${event.createdAt}, ${event.createdAt})
    ON CONFLICT (channel, external_message_id)
    WHERE external_message_id IS NOT NULL
    DO NOTHING
    RETURNING
      id,
      organization_id AS "organizationId",
      conversation_id AS "conversationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      external_message_id AS "externalMessageId",
      direction,
      author_type AS "authorType",
      author_id AS "authorId",
      text,
      attachments_json AS "attachmentsJson",
      created_at AS "createdAt",
      status,
      error_code AS "errorCode",
      error_message AS "errorMessage"
  `;
  if (rows[0]) {
    await touchClientCaseMessageState({
      conversationId: conversation.id,
      direction: "inbound",
      at: event.createdAt,
      text: event.text,
    }).catch((error) => console.warn("[messenger inbound] client case touch failed", error));
  }
  return rows[0] ? toMessage(rows[0]) : null;
}

function startAgentForInboundMessage(input: { organizationId: string; conversationId: string; messageId: string; text: string }) {
  // Hard stop during the internal-assistant rollout: inbound client messages
  // are recorded normally, but they cannot start an OpenAI run.
  if (process.env.CLIENT_AI_AGENT_ENABLED?.trim().toLowerCase() !== "true") return;
  if (!input.text.trim()) return;
  void import("@/lib/ai-agent/runner")
    .then(({ triggerAgentForInboundMessage }) => triggerAgentForInboundMessage(input))
    .catch((error) => console.warn("[ai-agent inbound]", error instanceof Error ? error.message : String(error)));
}

function externalUpdateIdFromPayload(channel: MessengerChannel, payload: unknown) {
  if (payload && typeof payload === "object" && "update_id" in payload) {
    const updateId = (payload as { update_id?: unknown }).update_id;
    if (updateId !== undefined && updateId !== null) return String(updateId);
  }
  return `${channel}:${crypto.createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex")}`;
}

async function saveWebhookEvent(channel: MessengerChannel, externalUpdateId: string, rawJson: Record<string, unknown>) {
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO messenger_webhook_events
      (id, organization_id, channel, external_update_id, raw_json)
    VALUES
      (${id}, ${organizationId}, ${channel}, ${externalUpdateId}, ${JSON.stringify(rawJson)}::jsonb)
    ON CONFLICT (channel, external_update_id) DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id ? { id: rows[0].id, duplicate: false } : { id: null, duplicate: true };
}

async function finishWebhookEvent(webhookId: string | null, error?: string | null) {
  if (!webhookId) return;
  await prisma.$executeRaw`
    UPDATE messenger_webhook_events
    SET processed_at = now(), error = ${error ?? null}
    WHERE id = ${webhookId}
  `;
}

function parseCommand(text: string) {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const command = first.split("@")[0];
  return command === "/start" || command === "/help" || command === "/stop" || command === "/status" ? command : null;
}

function parseStartPayload(text: string) {
  const parts = text.trim().split(/\s+/);
  return parts[0]?.toLowerCase().split("@")[0] === "/start" ? parts[1]?.trim() ?? "" : "";
}

async function handleTelegramCommand(command: "/start" | "/help" | "/stop" | "/status", conversation: Conversation, event: IncomingMessageEvent) {
  if (command === "/start") {
    const payload = parseStartPayload(event.text);
    if (payload.startsWith("client_")) {
      const token = payload.slice("client_".length);
      const result = await linkTelegramClientFromStartToken(token, event);
      if (result.ok) {
        return sendMessage({
          conversationId: conversation.id,
          text: "Telegram привязан к вашей карточке клиента. Теперь можно писать сюда по вопросам записей, диагностик и отгрузок.",
          createdByLogin: "system",
        });
      }
      const expired = result.reason === "expired";
      return sendMessage({
        conversationId: conversation.id,
        text: expired
          ? "Ссылка для привязки Telegram устарела. Попросите сотрудника Эко-платформы создать новую ссылку."
          : "Не удалось привязать Telegram: ссылка уже использована или не найдена. Попросите сотрудника создать новую ссылку.",
        createdByLogin: "system",
      });
    }
    if (payload.startsWith("employee_")) {
      const token = payload.slice("employee_".length);
      const result = await linkTelegramEmployeeFromStartToken(token, event);
      if (result.ok) {
        return sendMessage({
          conversationId: conversation.id,
          text: "Telegram привязан к вашему профилю сотрудника. Сюда будут приходить задачи, напоминания по записям и системные уведомления Эко-платформы.",
          createdByLogin: "system",
        });
      }
      const expired = result.reason === "expired";
      return sendMessage({
        conversationId: conversation.id,
        text: expired
          ? "Ссылка для привязки Telegram к профилю сотрудника устарела. Создайте новую ссылку в личном кабинете."
          : "Не удалось привязать Telegram к профилю сотрудника: ссылка уже использована или не найдена.",
        createdByLogin: "system",
      });
    }
    await prisma.$executeRaw`
      UPDATE messenger_connections
      SET is_active = true, blocked_at = NULL, last_seen_at = now(), updated_at = now()
      WHERE organization_id = ${getMessengerOrganizationId()}
        AND channel = ${event.channel}
        AND external_chat_id = ${event.externalConversationId}
    `;
    await prisma.$executeRaw`
      UPDATE messenger_conversations
      SET status = 'open', updated_at = now()
      WHERE id = ${conversation.id}
        AND organization_id = ${conversation.organizationId ?? getMessengerOrganizationId()}
    `;
    return sendMessage({
      conversationId: conversation.id,
      text: "Здравствуйте! ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ получил ваше сообщение. Напишите вопрос, VIN или номер записи.",
      createdByLogin: "system",
    });
  }
  if (command === "/help") {
    return sendMessage({
      conversationId: conversation.id,
      text: "Команды: /start — начать диалог, /status — статус связи, /stop — остановить сообщения, /help — помощь.",
      createdByLogin: "system",
    });
  }
  if (command === "/stop") {
    const result = await sendMessage({
      conversationId: conversation.id,
      text: "Остановили сообщения в этом Telegram-чате. Чтобы снова начать диалог, отправьте /start.",
      createdByLogin: "system",
    });
    await prisma.$executeRaw`
      UPDATE messenger_connections
      SET is_active = false, blocked_at = now(), updated_at = now()
      WHERE organization_id = ${getMessengerOrganizationId()}
        AND channel = ${event.channel}
        AND external_chat_id = ${event.externalConversationId}
    `;
    await prisma.$executeRaw`
      UPDATE messenger_conversations
      SET status = 'blocked', updated_at = now()
      WHERE id = ${conversation.id}
        AND organization_id = ${conversation.organizationId ?? getMessengerOrganizationId()}
    `;
    return result;
  }
  return sendMessage({
    conversationId: conversation.id,
    text: `Статус связи: ${conversation.status === "blocked" ? "остановлена" : "активна"}. Последнее сообщение получено.`,
    createdByLogin: "system",
  });
}

export async function ingestIncomingEvent(event: IncomingMessageEvent) {
  await ensureMessengerIntegrationCoreSchema();
  const webhookId = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const inserted = await prisma.$executeRaw`
    INSERT INTO messenger_webhook_events
      (id, organization_id, channel, external_update_id, raw_json)
    VALUES
      (${webhookId}, ${organizationId}, ${event.channel}, ${event.externalEventId}, ${JSON.stringify({ eventType: event.eventType, ...event.raw })}::jsonb)
    ON CONFLICT (channel, external_update_id) DO NOTHING
  `;
  if (!inserted) return { ok: true, duplicate: true };
  try {
    const conversation = await upsertConversationFromIncoming(event);
    const message = await insertIncomingMessage(conversation, event);
    if (message) {
      startAgentForInboundMessage({
        organizationId: conversation.organizationId ?? organizationId,
        conversationId: conversation.id,
        messageId: message.id,
        text: event.text,
      });
    }
    await prisma.$executeRaw`
      UPDATE messenger_webhook_events
      SET processed_at = now(), error = NULL
      WHERE id = ${webhookId}
    `;
    return { ok: true, conversation, message };
  } catch (error) {
    await prisma.$executeRaw`
      UPDATE messenger_webhook_events
      SET processed_at = now(), error = ${error instanceof Error ? error.message : "messenger ingest failed"}
      WHERE id = ${webhookId}
    `;
    throw error;
  }
}

export async function ingestTelegramWebhook(payload: unknown, headers?: Headers) {
  await assertTelegramWebhookSecret(headers);
  const rawJson = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : { value: payload };
  const externalUpdateId = externalUpdateIdFromPayload("telegram", payload);
  const webhook = await saveWebhookEvent("telegram", externalUpdateId, rawJson);
  if (webhook.duplicate) return { ok: true, accepted: true, duplicate: true, externalUpdateId };

  try {
    const events = await telegramChannelAdapter.parseWebhook?.(payload);
    if (!events?.length) {
      await finishWebhookEvent(webhook.id);
      return { ok: true, accepted: true, ignored: true, externalUpdateId, reason: "unsupported telegram update" };
    }
    const processed = [];
    let commandError: string | null = null;
    for (const event of events) {
      const conversation = await upsertConversationFromIncoming(event);
      const message = await insertIncomingMessage(conversation, event);
      const command = parseCommand(event.text);
      let commandResult: SendMessageResult | null | undefined;
      if (command) commandResult = await handleTelegramCommand(command, conversation, event);
      if (message && !command) {
        startAgentForInboundMessage({
          organizationId: conversation.organizationId ?? getMessengerOrganizationId(),
          conversationId: conversation.id,
          messageId: message.id,
          text: event.text,
        });
      }
      commandError ||= commandResult && !commandResult.ok ? commandResult.error ?? "telegram command failed" : null;
      processed.push({ conversation, message, command });
    }
    await finishWebhookEvent(webhook.id, commandError);
    return { ok: true, accepted: true, processed, commandError };
  } catch (error) {
    const message = error instanceof Error ? error.message : "telegram webhook processing failed";
    await finishWebhookEvent(webhook.id, message);
    return { ok: false, accepted: true, error: message, externalUpdateId };
  }
}

export async function pollTelegramUpdates(input: { offset?: number; limit?: number; timeout?: number } = {}) {
  const updates = await getTelegramUpdates(input);
  if (!updates.ok) return updates;
  const processed = [];
  for (const update of updates.updates) {
    const events = await telegramChannelAdapter.parseWebhook?.(update);
    if (!events?.length) {
      processed.push({ ok: true, ignored: true, updateId: update.update_id });
      continue;
    }
    for (const event of events) {
      processed.push(await ingestIncomingEvent(event));
    }
  }
  const nextOffset =
    updates.updates.length > 0
      ? Math.max(...updates.updates.map((update) => update.update_id ?? 0).filter(Boolean)) + 1
      : input.offset;
  return { ok: true as const, processed, nextOffset };
}

export async function syncTelegramUserConversations(input: { accountId?: string; limit?: number; force?: boolean } = {}) {
  return syncTelegramUserAccount(input.accountId, input.limit ?? 40, { force: input.force });
}

export async function listTemplates() {
  return listMessageTemplates();
}
