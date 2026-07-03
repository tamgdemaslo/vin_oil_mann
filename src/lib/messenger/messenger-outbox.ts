import crypto from "crypto";
import { prisma } from "@/lib/db";
import { mockChannelAdapter } from "./channels/mock";
import { plannedChannelAdapters } from "./channels/planned";
import { telegramUserSessionAdapter } from "./channels/telegram-user-session";
import { assertMessengerOutboundTextSafe } from "./messenger-security";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationId } from "./messenger-tenant";
import type { ChannelSendResult, MessengerChannelAdapter } from "./channels/types";
import type { MessageOutbox, MessengerChannel } from "./messenger-types";

type OutboxRow = {
  id: string;
  organizationId: string;
  messengerAccountId: string | null;
  channel: MessengerChannel;
  conversationId: string | null;
  messageId: string | null;
  connectionId: string | null;
  recipientExternalChatId: string;
  messageType: MessageOutbox["messageType"];
  text: string;
  attachmentsJson: MessageOutbox["attachmentsJson"];
  templateKey: string | null;
  templateVarsJson: Record<string, unknown> | null;
  status: MessageOutbox["status"];
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const adapters: Partial<Record<MessengerChannel, MessengerChannelAdapter>> = {
  telegram: telegramUserSessionAdapter,
  mock: mockChannelAdapter,
  ...plannedChannelAdapters,
};

function toOutbox(row: OutboxRow): MessageOutbox {
  return {
    id: row.id,
    organizationId: row.organizationId,
    messengerAccountId: row.messengerAccountId,
    channel: row.channel,
    conversationId: row.conversationId,
    messageId: row.messageId,
    connectionId: row.connectionId,
    recipientExternalChatId: row.recipientExternalChatId,
    messageType: row.messageType,
    text: row.text,
    attachmentsJson: row.attachmentsJson ?? [],
    templateKey: row.templateKey,
    templateVarsJson: row.templateVarsJson,
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function enqueueMessageOutbox(input: {
  organizationId?: string;
  conversationId: string;
  messageId?: string | null;
  connectionId?: string | null;
  channel: MessengerChannel;
  recipientExternalChatId: string;
  messengerAccountId?: string | null;
  messageType?: MessageOutbox["messageType"];
  text: string;
  attachmentsJson?: MessageOutbox["attachmentsJson"];
  templateKey?: string | null;
  templateVarsJson?: Record<string, unknown> | null;
}): Promise<MessageOutbox> {
  await ensureMessengerIntegrationCoreSchema();
  assertMessengerOutboundTextSafe(input.text);
  const id = crypto.randomUUID();
  const organizationId = input.organizationId ?? getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<OutboxRow[]>`
    INSERT INTO messenger_outbox
      (id, organization_id, messenger_account_id, channel, conversation_id, message_id, connection_id, recipient_external_chat_id, message_type, text, attachments_json,
       template_key, template_vars_json, status, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, ${input.messengerAccountId ?? null}, ${input.channel}, ${input.conversationId}, ${input.messageId ?? null}, ${input.connectionId ?? null}, ${input.recipientExternalChatId},
       ${input.messageType ?? "text"}, ${input.text}, ${JSON.stringify(input.attachmentsJson ?? [])}::jsonb, ${input.templateKey ?? null}, ${input.templateVarsJson ? JSON.stringify(input.templateVarsJson) : null}::jsonb, 'queued', now(), now())
    RETURNING
      id,
      organization_id AS "organizationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      conversation_id AS "conversationId",
      message_id AS "messageId",
      connection_id AS "connectionId",
      recipient_external_chat_id AS "recipientExternalChatId",
      message_type AS "messageType",
      text,
      attachments_json AS "attachmentsJson",
      template_key AS "templateKey",
      template_vars_json AS "templateVarsJson",
      status,
      attempts,
      last_attempt_at AS "lastAttemptAt",
      next_attempt_at AS "nextAttemptAt",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  return toOutbox(rows[0]);
}

function resultErrorCode(raw: Record<string, unknown> | undefined) {
  const rawCode = raw?.errorCode;
  return typeof rawCode === "number" || typeof rawCode === "string" ? String(rawCode) : null;
}

function retryDelayAt(errorCode: string | null, error: string) {
  const code = Number(errorCode);
  const retryable = code === 429 || code >= 500 || /timeout|temporar|econnreset|network/i.test(error);
  return retryable ? new Date(Date.now() + 5 * 60_000) : null;
}

export async function processOutboxItem(outbox: MessageOutbox): Promise<MessageOutbox> {
  await ensureMessengerIntegrationCoreSchema();
  const adapter = adapters[outbox.channel] ?? mockChannelAdapter;
  await prisma.$executeRaw`
    UPDATE messenger_outbox
    SET status = 'processing', attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
    WHERE id = ${outbox.id}
  `;
  let result: ChannelSendResult;
  try {
    result = await adapter.sendMessage(outbox);
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : "Messenger adapter failed",
    };
  }
  if (result.ok) {
    const status = result.status ?? (adapter.getConnection().connectionStatus === "dry_run" ? "skipped" : "sent");
    const rows = await prisma.$queryRaw<OutboxRow[]>`
      UPDATE messenger_outbox
      SET status = ${status},
          error_code = NULL,
          error_message = NULL,
          updated_at = now()
      WHERE id = ${outbox.id}
      RETURNING
        id,
        organization_id AS "organizationId",
        messenger_account_id AS "messengerAccountId",
        channel,
        conversation_id AS "conversationId",
        message_id AS "messageId",
        connection_id AS "connectionId",
        recipient_external_chat_id AS "recipientExternalChatId",
        message_type AS "messageType",
        text,
        attachments_json AS "attachmentsJson",
        template_key AS "templateKey",
        template_vars_json AS "templateVarsJson",
        status,
        attempts,
        last_attempt_at AS "lastAttemptAt",
        next_attempt_at AS "nextAttemptAt",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
    if (outbox.messageId) {
      await prisma.$executeRaw`
      UPDATE messenger_messages
      SET status = ${status},
            external_message_id = COALESCE(${result.channelMessageId ?? null}, external_message_id),
            error_code = NULL,
            error_message = NULL,
            sent_at = CASE WHEN ${status} = 'sent' THEN now() ELSE sent_at END,
            updated_at = now()
      WHERE id = ${outbox.messageId}
        AND organization_id = ${outbox.organizationId ?? getMessengerOrganizationId()}
      `;
    }
    return toOutbox(rows[0]);
  }
  const errorCode = resultErrorCode(result.raw);
  const nextAttemptAt = retryDelayAt(errorCode, result.error);
  const rows = await prisma.$queryRaw<OutboxRow[]>`
    UPDATE messenger_outbox
    SET status = 'failed',
        error_code = ${errorCode},
        error_message = ${result.error},
        next_attempt_at = ${nextAttemptAt},
        updated_at = now()
    WHERE id = ${outbox.id}
    RETURNING
      id,
      organization_id AS "organizationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      conversation_id AS "conversationId",
      message_id AS "messageId",
      connection_id AS "connectionId",
      recipient_external_chat_id AS "recipientExternalChatId",
      message_type AS "messageType",
      text,
      attachments_json AS "attachmentsJson",
      template_key AS "templateKey",
      template_vars_json AS "templateVarsJson",
      status,
      attempts,
      last_attempt_at AS "lastAttemptAt",
      next_attempt_at AS "nextAttemptAt",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  if (outbox.messageId) {
    await prisma.$executeRaw`
      UPDATE messenger_messages
      SET status = 'failed',
          error_code = ${errorCode},
          error_message = ${result.error},
          updated_at = now()
      WHERE id = ${outbox.messageId}
        AND organization_id = ${outbox.organizationId ?? getMessengerOrganizationId()}
    `;
  }
  return toOutbox(rows[0]);
}

export async function retryMessageOutbox(input: { conversationId: string; messageId: string }): Promise<MessageOutbox> {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<OutboxRow[]>`
    UPDATE messenger_outbox
    SET status = 'queued',
        error_code = NULL,
        error_message = NULL,
        next_attempt_at = NULL,
        updated_at = now()
    WHERE message_id = ${input.messageId}
      AND conversation_id = ${input.conversationId}
      AND organization_id = ${organizationId}
    RETURNING
      id,
      organization_id AS "organizationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      conversation_id AS "conversationId",
      message_id AS "messageId",
      connection_id AS "connectionId",
      recipient_external_chat_id AS "recipientExternalChatId",
      message_type AS "messageType",
      text,
      attachments_json AS "attachmentsJson",
      template_key AS "templateKey",
      template_vars_json AS "templateVarsJson",
      status,
      attempts,
      last_attempt_at AS "lastAttemptAt",
      next_attempt_at AS "nextAttemptAt",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  if (!rows[0]) {
    throw new Error("Не найдена очередь отправки для этого сообщения");
  }
  await prisma.$executeRaw`
    UPDATE messenger_messages
    SET status = 'queued',
        error_code = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = ${input.messageId}
      AND conversation_id = ${input.conversationId}
      AND organization_id = ${organizationId}
  `;
  return processOutboxItem(toOutbox(rows[0]));
}

export async function processPendingOutbox(limit = 20) {
  await ensureMessengerIntegrationCoreSchema();
  const rows = await prisma.$queryRaw<OutboxRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      messenger_account_id AS "messengerAccountId",
      channel,
      conversation_id AS "conversationId",
      message_id AS "messageId",
      connection_id AS "connectionId",
      recipient_external_chat_id AS "recipientExternalChatId",
      message_type AS "messageType",
      text,
      attachments_json AS "attachmentsJson",
      template_key AS "templateKey",
      template_vars_json AS "templateVarsJson",
      status,
      attempts,
      last_attempt_at AS "lastAttemptAt",
      next_attempt_at AS "nextAttemptAt",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM messenger_outbox
    WHERE status = 'queued'
       OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now() AND attempts < 5)
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  const processed: MessageOutbox[] = [];
  for (const row of rows) {
    processed.push(await processOutboxItem(toOutbox(row)));
  }
  return processed;
}
