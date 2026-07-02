import crypto from "crypto";
import { prisma } from "@/lib/db";
import { enqueueMessageOutbox, processOutboxItem } from "./messenger-outbox";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { assertMessengerOutboundTextSafe } from "./messenger-security";
import { listMessageTemplates } from "./messenger-templates";
import { getMessengerOrganizationId } from "./messenger-tenant";
import type { MessageOutbox } from "./messenger-types";

type EmployeeTelegramConnectionRow = {
  id: string;
  externalChatId: string;
  displayName: string;
};

type ConversationIdRow = {
  id: string;
};

type MessageIdRow = {
  id: string;
};

export type EmployeeMessengerNotificationResult =
  | {
      ok: true;
      status: "sent" | "queued" | "skipped" | "failed";
      conversationId: string;
      messageId: string;
      outbox: MessageOutbox;
    }
  | {
      ok: false;
      status: "skipped" | "failed";
      error: string | null;
    };

function renderTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

async function templateText(key: string, fallback: string) {
  const templates = await listMessageTemplates();
  return templates.find((template) => template.key === key)?.text ?? fallback;
}

async function findEmployeeTelegramConnection(employeeId: string) {
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<EmployeeTelegramConnectionRow[]>`
    SELECT
      id,
      external_chat_id AS "externalChatId",
      display_name AS "displayName"
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND type = 'employee'
      AND employee_id = ${employeeId}
      AND is_active = true
      AND blocked_at IS NULL
    ORDER BY linked_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function upsertEmployeeConversation(input: {
  employeeId: string;
  connection: EmployeeTelegramConnectionRow;
  text: string;
}) {
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<ConversationIdRow[]>`
    INSERT INTO messenger_conversations
      (id, organization_id, channel, external_conversation_id, connection_id, employee_id, title, participant_name,
       status, unread_count, last_message_text, last_message_at, updated_at)
    VALUES
      (${id}, ${organizationId}, 'telegram', ${input.connection.externalChatId}, ${input.connection.id}, ${input.employeeId},
       'Уведомления сотрудника', ${input.connection.displayName}, 'open', 0, ${input.text}, now(), now())
    ON CONFLICT (channel, external_conversation_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      connection_id = EXCLUDED.connection_id,
      employee_id = COALESCE(EXCLUDED.employee_id, messenger_conversations.employee_id),
      title = EXCLUDED.title,
      participant_name = EXCLUDED.participant_name,
      last_message_text = EXCLUDED.last_message_text,
      last_message_at = now(),
      status = 'open',
      updated_at = now()
    RETURNING id
  `;
  return rows[0]?.id ?? id;
}

async function insertEmployeeNotificationMessage(input: { conversationId: string; text: string }) {
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<MessageIdRow[]>`
    INSERT INTO messenger_messages
      (id, organization_id, conversation_id, channel, direction, author_type, text, attachments_json, status, created_at)
    VALUES
      (${id}, ${organizationId}, ${input.conversationId}, 'telegram', 'outbound', 'system', ${input.text}, '[]'::jsonb, 'queued', now())
    RETURNING id
  `;
  return rows[0]?.id ?? id;
}

export async function sendEmployeeTelegramTemplate(input: {
  employeeId: string;
  templateKey: string;
  fallbackText: string;
  variables: Record<string, string>;
}): Promise<EmployeeMessengerNotificationResult> {
  await ensureMessengerIntegrationCoreSchema();
  const connection = await findEmployeeTelegramConnection(input.employeeId);
  if (!connection) return { ok: false, status: "skipped", error: "Telegram сотрудника не привязан" };

  const text = renderTemplate(await templateText(input.templateKey, input.fallbackText), input.variables);
  assertMessengerOutboundTextSafe(text);
  const conversationId = await upsertEmployeeConversation({
    employeeId: input.employeeId,
    connection,
    text,
  });
  const messageId = await insertEmployeeNotificationMessage({ conversationId, text });
  const outbox = await enqueueMessageOutbox({
    conversationId,
    messageId,
    connectionId: connection.id,
    channel: "telegram",
    recipientExternalChatId: connection.externalChatId,
    messageType: "template",
    templateKey: input.templateKey,
    templateVarsJson: input.variables,
    text,
  });
  const processed = await processOutboxItem(outbox);
  return {
    ok: true,
    status:
      processed.status === "sent" || processed.status === "skipped" || processed.status === "failed"
        ? processed.status
        : "queued",
    conversationId,
    messageId,
    outbox: processed,
  };
}

export async function sendEmployeeTodayAppointmentSummary(input: {
  employeeId: string;
  appointments: Array<{
    time: string;
    client: string;
    vehicle?: string | null;
    service?: string | null;
  }>;
}) {
  const summary = input.appointments.length
    ? input.appointments
        .map((item) =>
          [item.time, item.client, item.vehicle, item.service]
            .map((part) => part?.trim())
            .filter(Boolean)
            .join(" · ")
        )
        .join("\n")
    : "На сегодня записей нет.";
  return sendEmployeeTelegramTemplate({
    employeeId: input.employeeId,
    templateKey: "appointment_today_summary",
    fallbackText: "Сводка записей на сегодня:\n{{summary}}",
    variables: { summary },
  });
}
