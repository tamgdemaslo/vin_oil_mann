import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listMessages } from "@/lib/messenger/messenger-gateway";
import { enqueueMessageOutbox, processOutboxItem } from "@/lib/messenger/messenger-outbox";
import { refreshMessageAttachmentsJson } from "@/lib/messenger/messenger-media";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import {
  messengerObjectKey,
  messengerStorageProxyUrl,
  messengerStorageStatus,
  putMessengerStorageObject,
  safeStorageFileName,
} from "@/lib/messenger/messenger-storage";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";
import { assertMessengerOutboundTextSafe } from "@/lib/messenger/messenger-security";
import type { Attachment, MessengerChannel } from "@/lib/messenger/messenger-types";

export const dynamic = "force-dynamic";

type ConversationRow = {
  id: string;
  organizationId: string;
  messengerAccountId: string | null;
  channel: MessengerChannel;
  externalConversationId: string;
};

function uploadLimitBytes() {
  const mb = Number(process.env.MESSENGER_UPLOAD_MAX_MB ?? 20);
  return Math.max(1, Number.isFinite(mb) ? mb : 20) * 1024 * 1024;
}

function attachmentType(mimeType: string) {
  if (mimeType.startsWith("image/")) return "photo" as const;
  if (mimeType.startsWith("video/")) return "video" as const;
  if (mimeType.startsWith("audio/")) return "audio" as const;
  return "document" as const;
}

function messageTypeForAttachment(type: Attachment["type"]) {
  return type === "photo" || type === "image" ? "image" : "file";
}

function previewLabel(type: Attachment["type"], name: string) {
  if (type === "photo" || type === "image") return "Фото";
  if (type === "video") return "Видео";
  if (type === "audio") return "Аудио";
  return name || "Документ";
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Не удалось отправить вложение" },
    { status: 500 }
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  await ensureMessengerIntegrationCoreSchema();
  const storage = messengerStorageStatus();
  if (!storage.configured) {
    return NextResponse.json({ error: "Object storage для Messenger не настроен", storage }, { status: 503 });
  }

  const { id: conversationId } = await params;
  const organizationId = getMessengerOrganizationId();
  try {
    const conversations = await prisma.$queryRaw<ConversationRow[]>`
      SELECT
        id,
        organization_id AS "organizationId",
        messenger_account_id AS "messengerAccountId",
        channel,
        external_conversation_id AS "externalConversationId"
      FROM messenger_conversations
      WHERE id = ${conversationId}
        AND organization_id = ${organizationId}
      LIMIT 1
    `;
    const conversation = conversations[0];
    if (!conversation) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });

    const form = await request.formData();
    const file = form.get("file");
    const caption = typeof form.get("caption") === "string" ? String(form.get("caption")).trim() : "";
    if (!(file instanceof File)) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
    if (caption) assertMessengerOutboundTextSafe(caption);
    const buffer = Buffer.from(await file.arrayBuffer());
    const limit = uploadLimitBytes();
    if (buffer.length > limit) {
      return NextResponse.json({ error: `Файл больше лимита отправки (${Math.round(limit / 1024 / 1024)} МБ)` }, { status: 413 });
    }
    const mimeType = file.type || "application/octet-stream";
    const type = attachmentType(mimeType);
    const messageId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const safeName = safeStorageFileName(file.name || `${type}-${attachmentId}`);
    const displayName = file.name?.trim() || safeName;
    const key = messengerObjectKey(
      [
        "messenger",
        organizationId,
        conversation.channel,
        "accounts",
        conversation.messengerAccountId,
        "conversations",
        conversation.id,
        "attachments",
        attachmentId,
      ],
      safeName
    );
    await putMessengerStorageObject({
      key,
      body: buffer,
      contentType: mimeType,
      cacheControl: "private, max-age=31536000, immutable",
      contentDisposition: `inline; filename="${encodeURIComponent(safeName)}"`,
    });

    const attachment: Attachment = {
      id: attachmentId,
      type,
      name: displayName,
      size: buffer.length,
      mimeType,
      status: "available",
      url: messengerStorageProxyUrl("attachment", attachmentId),
      previewUrl: type === "photo" ? messengerStorageProxyUrl("thumbnail", attachmentId) : undefined,
      caption: caption || undefined,
    };
    const text = caption;
    await prisma.$executeRaw`
      INSERT INTO messenger_messages
        (id, organization_id, conversation_id, messenger_account_id, channel, direction, author_type, message_type, text, attachments_json, status, created_at, updated_at)
      VALUES
        (${messageId}, ${organizationId}, ${conversation.id}, ${conversation.messengerAccountId}, ${conversation.channel}, 'outbound', 'employee',
         ${messageTypeForAttachment(type)}, ${text}, ${JSON.stringify([attachment])}::jsonb, 'queued', now(), now())
    `;
    await prisma.$executeRaw`
      INSERT INTO messenger_attachments
        (id, organization_id, messenger_account_id, conversation_id, message_id, channel, direction, external_attachment_id,
         type, url, name, size, mime_type, preview_url, original_storage_key, thumbnail_storage_key,
         status, progress, caption, metadata_json, created_at, updated_at)
      VALUES
        (${attachmentId}, ${organizationId}, ${conversation.messengerAccountId}, ${conversation.id}, ${messageId}, ${conversation.channel}, 'outbound', ${attachmentId},
         ${type}, ${attachment.url ?? null}, ${displayName}, ${buffer.length}, ${mimeType}, ${attachment.previewUrl ?? null}, ${key}, ${type === "photo" ? key : null},
         'ready', 100, ${caption || null}, ${JSON.stringify({ source: "eco_upload", storage: { key, mimeType, size: buffer.length } })}::jsonb, now(), now())
    `;
    await refreshMessageAttachmentsJson(messageId);
    await prisma.$executeRaw`
      UPDATE messenger_conversations
      SET last_message_text = ${text || previewLabel(type, displayName)},
          last_message_at = now(),
          status = 'open',
          unread_count = 0,
          updated_at = now()
      WHERE id = ${conversation.id}
        AND organization_id = ${organizationId}
    `;
    const outbox = await enqueueMessageOutbox({
      organizationId,
      conversationId: conversation.id,
      messageId,
      channel: conversation.channel,
      recipientExternalChatId: conversation.externalConversationId,
      messengerAccountId: conversation.messengerAccountId,
      messageType: messageTypeForAttachment(type),
      text,
      attachmentsJson: [attachment],
    });
    const processed = await processOutboxItem(outbox);
    const message = (await listMessages(conversation.id)).find((item) => item.id === messageId);
    return NextResponse.json(
      { ok: processed.status !== "failed", message, outbox: processed, error: processed.errorMessage ?? undefined },
      { status: processed.status === "failed" ? 202 : 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
