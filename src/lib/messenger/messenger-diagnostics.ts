import crypto from "crypto";
import type { NextRequest } from "next/server";
import {
  diagnosticCriticalText,
  diagnosticRecommendationText,
  stripDiagnosticReportLink,
} from "@/lib/diagnostic-report-message";
import { buildDiagnosticReportUrl } from "@/lib/diagnostic-report-link";
import { prisma } from "@/lib/db";
import { enqueueMessageOutbox, processOutboxItem } from "./messenger-outbox";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { assertMessengerOutboundTextSafe } from "./messenger-security";
import { listMessageTemplates } from "./messenger-templates";
import { getMessengerOrganizationId } from "./messenger-tenant";
import type { MessageOutbox } from "./messenger-types";

type DiagnosticSource = "legacy" | "map";

type DiagnosticReportTarget = {
  source: DiagnosticSource;
  diagnosticId: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  vehicleName: string;
  reportToken: string | null;
  reportUrl: string | null;
  shipmentId: string | null;
  checkedCount: number;
  recommendationCount: number;
  criticalCount: number;
};

type TelegramConnectionRow = {
  id: string;
  externalChatId: string;
  displayName: string;
};

type ConversationIdRow = {
  id: string;
};

type MessageRow = {
  id: string;
};

export type DiagnosticReportTelegramResult =
  | {
      ok: true;
      status: "sent" | "queued" | "skipped";
      reportUrl: string;
      conversationId: string;
      messageId: string;
      outbox: MessageOutbox;
    }
  | {
      ok: false;
      status: "missing_client" | "missing_report_token" | "telegram_not_linked";
      reportUrl?: string | null;
      clientId?: string | null;
      link?: {
        linkUrl: string | null;
        qrDataUrl: string | null;
        expiresAt: string;
      };
      error: string;
    };

function renderTemplate(text: string, vars: Record<string, string | number | boolean | null | undefined>) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => String(vars[key] ?? match));
}

async function diagnosticReportTemplateText() {
  const templates = await listMessageTemplates();
  return (
    templates.find((template) => template.key === "diagnostic_report")?.text ??
    "Диагностика готова\n\n{{clientName}}, диагностика {{vehicleName}} готова.\n\nПроверено {{checkedCount}} пунктов.\n{{recommendationText}}\n{{criticalText}}\n\nОткрыть отчёт: {{reportUrl}}"
  );
}

function vehicleName(input: { brand?: string | null; model?: string | null; licensePlate?: string | null; vin?: string | null }) {
  return [input.brand, input.model, input.licensePlate || input.vin].filter(Boolean).join(" · ") || "автомобилю";
}

async function resolveCounterparty(clientId: string | null) {
  if (!clientId) return null;
  return prisma.localCounterparty.findFirst({
    where: { OR: [{ id: clientId }, { moyskladId: clientId }] },
    select: { id: true, name: true, phone: true },
  });
}

async function resolveLegacyDiagnostic(request: NextRequest, diagnosticId: string): Promise<DiagnosticReportTarget | null> {
  const diagnostic = await prisma.diagnostic.findUnique({
    where: { id: diagnosticId },
    select: {
      id: true,
      agentMoySkladId: true,
      shipmentMoySkladId: true,
      shipmentDraftId: true,
      clientReportToken: true,
      brand: true,
      model: true,
      licensePlate: true,
      vin: true,
      summaryGreen: true,
      summaryYellow: true,
      summaryRed: true,
    },
  });
  if (!diagnostic) return null;
  const counterparty = await resolveCounterparty(diagnostic.agentMoySkladId);
  return {
    source: "legacy",
    diagnosticId: diagnostic.id,
    clientId: counterparty?.id ?? diagnostic.agentMoySkladId,
    clientName: counterparty?.name ?? "клиент",
    clientPhone: counterparty?.phone ?? null,
    vehicleName: vehicleName(diagnostic),
    reportToken: diagnostic.clientReportToken,
    reportUrl: diagnostic.clientReportToken ? buildDiagnosticReportUrl(request, diagnostic.clientReportToken) : null,
    shipmentId: diagnostic.shipmentMoySkladId ?? diagnostic.shipmentDraftId,
    checkedCount: diagnostic.summaryGreen + diagnostic.summaryYellow + diagnostic.summaryRed,
    recommendationCount: diagnostic.summaryYellow,
    criticalCount: diagnostic.summaryRed,
  };
}

async function resolveMapDiagnostic(request: NextRequest, diagnosticId: string): Promise<DiagnosticReportTarget | null> {
  const diagnostic = await prisma.diagnosticMapSession.findUnique({
    where: { id: diagnosticId },
    select: {
      id: true,
      clientId: true,
      clientName: true,
      clientPhone: true,
      demandId: true,
      publicToken: true,
      brand: true,
      model: true,
      licensePlate: true,
      vin: true,
      totalCount: true,
      attentionCount: true,
      replaceCount: true,
      noAccessCount: true,
      byMileageCount: true,
      byClientCount: true,
    },
  });
  if (!diagnostic) return null;
  const counterparty = await resolveCounterparty(diagnostic.clientId);
  return {
    source: "map",
    diagnosticId: diagnostic.id,
    clientId: counterparty?.id ?? diagnostic.clientId,
    clientName: counterparty?.name ?? diagnostic.clientName ?? "клиент",
    clientPhone: counterparty?.phone ?? diagnostic.clientPhone,
    vehicleName: vehicleName(diagnostic),
    reportToken: diagnostic.publicToken,
    reportUrl: diagnostic.publicToken ? buildDiagnosticReportUrl(request, diagnostic.publicToken) : null,
    shipmentId: diagnostic.demandId,
    checkedCount: diagnostic.totalCount,
    recommendationCount: diagnostic.attentionCount,
    criticalCount: diagnostic.replaceCount,
  };
}

async function findTelegramConnection(clientId: string) {
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<TelegramConnectionRow[]>`
    SELECT
      id,
      external_chat_id AS "externalChatId",
      display_name AS "displayName"
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND type = 'client'
      AND client_id = ${clientId}
      AND is_active = true
      AND blocked_at IS NULL
    ORDER BY linked_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function upsertTelegramConversation(target: DiagnosticReportTarget, connection: TelegramConnectionRow, text: string) {
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const title = `Диагностика · ${target.vehicleName}`;
  const rows = await prisma.$queryRaw<ConversationIdRow[]>`
    INSERT INTO messenger_conversations
      (id, organization_id, channel, external_conversation_id, connection_id, client_id, title, participant_name, participant_phone,
       status, unread_count, last_message_text, last_message_at, related_diagnostic_id, related_shipment_id, updated_at)
    VALUES
      (${id}, ${organizationId}, 'telegram', ${connection.externalChatId}, ${connection.id}, ${target.clientId}, ${title}, ${target.clientName},
       ${target.clientPhone}, 'open', 0, ${text}, now(), ${target.diagnosticId}, ${target.shipmentId}, now())
    ON CONFLICT (channel, external_conversation_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      connection_id = EXCLUDED.connection_id,
      client_id = COALESCE(EXCLUDED.client_id, messenger_conversations.client_id),
      title = EXCLUDED.title,
      participant_name = EXCLUDED.participant_name,
      participant_phone = COALESCE(EXCLUDED.participant_phone, messenger_conversations.participant_phone),
      last_message_text = EXCLUDED.last_message_text,
      last_message_at = now(),
      related_diagnostic_id = EXCLUDED.related_diagnostic_id,
      related_shipment_id = COALESCE(EXCLUDED.related_shipment_id, messenger_conversations.related_shipment_id),
      status = 'open',
      updated_at = now()
    RETURNING id
  `;
  return rows[0]?.id ?? id;
}

async function insertDiagnosticReportMessage(conversationId: string, text: string) {
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<MessageRow[]>`
    INSERT INTO messenger_messages
      (id, organization_id, conversation_id, channel, direction, author_type, text, attachments_json, status, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, ${conversationId}, 'telegram', 'outbound', 'employee', ${text}, '[]'::jsonb, 'queued', now(), now())
    RETURNING id
  `;
  return rows[0]?.id ?? id;
}

async function markReportSent(source: DiagnosticSource, diagnosticId: string) {
  if (source === "map") {
    await prisma.$executeRaw`
      UPDATE diagnostic_map_sessions
      SET report_sent_at = now(), updated_at = now()
      WHERE id = ${diagnosticId}
    `;
    return;
  }
  await prisma.$executeRaw`
    UPDATE diagnostics
    SET client_report_sent_at = now(), updated_at = now()
    WHERE id = ${diagnosticId}
  `;
}

export async function sendDiagnosticReportToTelegram(input: {
  source: DiagnosticSource;
  diagnosticId: string;
  request: NextRequest;
  createdById: string;
}): Promise<DiagnosticReportTelegramResult | null> {
  await ensureMessengerIntegrationCoreSchema();
  const target =
    input.source === "map"
      ? await resolveMapDiagnostic(input.request, input.diagnosticId)
      : await resolveLegacyDiagnostic(input.request, input.diagnosticId);
  if (!target) return null;
  if (!target.clientId) {
    return {
      ok: false,
      status: "missing_client",
      reportUrl: target.reportUrl,
      error: "У диагностики не указан clientId",
    };
  }
  if (!target.reportToken || !target.reportUrl) {
    return {
      ok: false,
      status: "missing_report_token",
      clientId: target.clientId,
      error: "У диагностики нет публичного токена отчёта",
    };
  }

  const connection = await findTelegramConnection(target.clientId);
  if (!connection) {
    return {
      ok: false,
      status: "telegram_not_linked",
      clientId: target.clientId,
      reportUrl: target.reportUrl,
      error: "Для отправки отчёта откройте диалог клиента в рабочем Telegram-аккаунте или скопируйте публичную ссылку отчёта.",
    };
  }

  const text = stripDiagnosticReportLink(renderTemplate(await diagnosticReportTemplateText(), {
    clientName: target.clientName,
    vehicleName: target.vehicleName,
    reportUrl: target.reportUrl,
    checkedCount: target.checkedCount,
    recommendationCount: target.recommendationCount,
    criticalCount: target.criticalCount,
    recommendationText: diagnosticRecommendationText(target.recommendationCount),
    criticalText: diagnosticCriticalText(target.criticalCount),
  }), target.reportUrl);
  assertMessengerOutboundTextSafe(text);
  const conversationId = await upsertTelegramConversation(target, connection, text);
  const messageId = await insertDiagnosticReportMessage(conversationId, text);
  const outbox = await enqueueMessageOutbox({
    conversationId,
    messageId,
    connectionId: connection.id,
    channel: "telegram",
    recipientExternalChatId: connection.externalChatId,
    text,
    templateVarsJson: { telegram: { disableWebPagePreview: true, buttons: [{ text: "Открыть отчёт", url: target.reportUrl }] } },
  });
  const processed = await processOutboxItem(outbox);
  await markReportSent(target.source, target.diagnosticId);

  return {
    ok: true,
    status: processed.status === "sent" || processed.status === "skipped" ? processed.status : "queued",
    reportUrl: target.reportUrl,
    conversationId,
    messageId,
    outbox: processed,
  };
}
