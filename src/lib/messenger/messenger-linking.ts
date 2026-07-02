import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getTelegramStoredSettings } from "./messenger-channel-settings";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationId } from "./messenger-tenant";
import type { IncomingMessageEvent, MessengerChannel } from "./messenger-types";

type LinkTokenRow = {
  id: string;
  organizationId: string;
  token: string;
  channel: MessengerChannel;
  type: "client" | "employee";
  clientId: string | null;
  employeeId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
};

type ConnectionRow = {
  id: string;
  externalChatId: string;
  externalUsername: string | null;
  displayName: string;
  linkedAt: Date | null;
  lastSeenAt: Date | null;
  blockedAt: Date | null;
};

type ConnectionIdRow = {
  id: string;
};

const DEFAULT_LINK_TTL_MINUTES = 60;
const MAX_LINK_TTL_MINUTES = 24 * 60;

function createTokenValue() {
  return crypto.randomBytes(24).toString("base64url");
}

function normalizeLinkTtlMinutes(value: number | undefined) {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_LINK_TTL_MINUTES;
  return Math.min(MAX_LINK_TTL_MINUTES, Math.max(1, Math.trunc(value ?? DEFAULT_LINK_TTL_MINUTES)));
}

async function reserveLinkToken(row: LinkTokenRow) {
  if (row.usedAt) return { ok: false as const, reason: "used" as const };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: "expired" as const };
  const rows = await prisma.$queryRaw<ConnectionIdRow[]>`
    UPDATE messenger_link_tokens
    SET used_at = now()
    WHERE id = ${row.id}
      AND organization_id = ${row.organizationId}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING id
  `;
  return rows[0]?.id ? { ok: true as const } : { ok: false as const, reason: "used" as const };
}

export function telegramBotDeepLink(token: string) {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (!username) return null;
  return `https://t.me/${username}?start=client_${token}`;
}

export function telegramEmployeeDeepLink(token: string) {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (!username) return null;
  return `https://t.me/${username}?start=employee_${token}`;
}

async function telegramBotDeepLinkFromSettings(token: string, type: "client" | "employee") {
  const settings = await getTelegramStoredSettings();
  const username = settings.botUsername?.trim().replace(/^@/, "");
  if (!username) return null;
  return `https://t.me/${username}?start=${type}_${token}`;
}

export async function getClientTelegramStatus(clientId: string) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<ConnectionRow[]>`
    SELECT
      id,
      external_chat_id AS "externalChatId",
      external_username AS "externalUsername",
      display_name AS "displayName",
      linked_at AS "linkedAt",
      last_seen_at AS "lastSeenAt",
      blocked_at AS "blockedAt"
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND type = 'client'
      AND client_id = ${clientId}
      AND is_active = true
    ORDER BY linked_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { connected: false as const };
  return {
    connected: true as const,
    connectionId: row.id,
    externalUsername: row.externalUsername,
    displayName: row.displayName,
    linkedAt: row.linkedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    blockedAt: row.blockedAt?.toISOString() ?? null,
  };
}

export async function getEmployeeTelegramStatus(employeeId: string) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<ConnectionRow[]>`
    SELECT
      id,
      external_chat_id AS "externalChatId",
      external_username AS "externalUsername",
      display_name AS "displayName",
      linked_at AS "linkedAt",
      last_seen_at AS "lastSeenAt",
      blocked_at AS "blockedAt"
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND type = 'employee'
      AND employee_id = ${employeeId}
      AND is_active = true
    ORDER BY linked_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { connected: false as const };
  return {
    connected: true as const,
    connectionId: row.id,
    externalUsername: row.externalUsername,
    displayName: row.displayName,
    linkedAt: row.linkedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    blockedAt: row.blockedAt?.toISOString() ?? null,
  };
}

export async function createClientTelegramLinkToken(input: { clientId: string; createdById?: string | null; ttlMinutes?: number }) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const token = createTokenValue();
  const expiresAt = new Date(Date.now() + normalizeLinkTtlMinutes(input.ttlMinutes) * 60_000);
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO messenger_link_tokens
      (id, organization_id, token, channel, type, client_id, expires_at, created_by_id)
    VALUES
      (${id}, ${organizationId}, ${token}, 'telegram', 'client', ${input.clientId}, ${expiresAt}, ${input.createdById ?? null})
  `;
  const linkUrl = await telegramBotDeepLinkFromSettings(token, "client");
  return { id, token, expiresAt: expiresAt.toISOString(), linkUrl };
}

export async function createEmployeeTelegramLinkToken(input: { employeeId: string; createdById?: string | null; ttlMinutes?: number }) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const token = createTokenValue();
  const expiresAt = new Date(Date.now() + normalizeLinkTtlMinutes(input.ttlMinutes) * 60_000);
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO messenger_link_tokens
      (id, organization_id, token, channel, type, employee_id, expires_at, created_by_id)
    VALUES
      (${id}, ${organizationId}, ${token}, 'telegram', 'employee', ${input.employeeId}, ${expiresAt}, ${input.createdById ?? null})
  `;
  const linkUrl = await telegramBotDeepLinkFromSettings(token, "employee");
  return { id, token, expiresAt: expiresAt.toISOString(), linkUrl };
}

export async function linkTelegramClientFromStartToken(token: string, event: IncomingMessageEvent) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<LinkTokenRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      token,
      channel,
      type,
      client_id AS "clientId",
      employee_id AS "employeeId",
      expires_at AS "expiresAt",
      used_at AS "usedAt"
    FROM messenger_link_tokens
    WHERE token = ${token}
      AND organization_id = ${organizationId}
      AND channel = 'telegram'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.type !== "client" || !row.clientId) return { ok: false as const, reason: "not_found" as const };
  const reserved = await reserveLinkToken(row);
  if (!reserved.ok) return reserved;

  const connectionId = crypto.randomUUID();
  const displayName = [event.firstName, event.lastName].filter(Boolean).join(" ") || event.participantName;
  const rawJson = {
    source: "telegram_start_link",
    firstName: event.firstName,
    lastName: event.lastName,
    username: event.externalUsername,
    update: event.raw,
  };

  const reusableByChat = await prisma.$queryRaw<ConnectionIdRow[]>`
    SELECT id
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND external_chat_id = ${event.externalConversationId}
    LIMIT 1
  `;
  const reusableByClient = await prisma.$queryRaw<ConnectionIdRow[]>`
    SELECT id
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND type = 'client'
      AND client_id = ${row.clientId}
    ORDER BY is_active DESC, linked_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;

  let linkedId = reusableByChat[0]?.id ?? reusableByClient[0]?.id ?? null;

  if (linkedId) {
    const linked = await prisma.$queryRaw<ConnectionIdRow[]>`
      UPDATE messenger_connections
      SET type = 'client',
          client_id = ${row.clientId},
          employee_id = NULL,
          supplier_id = NULL,
          external_user_id = COALESCE(${event.externalUserId ?? null}, external_user_id),
          external_chat_id = ${event.externalConversationId},
          external_username = ${event.externalUsername ?? null},
          display_name = ${displayName},
          is_active = true,
          linked_at = COALESCE(linked_at, now()),
          last_seen_at = ${event.createdAt},
          blocked_at = NULL,
          raw_json = ${JSON.stringify(rawJson)}::jsonb,
          updated_at = now()
      WHERE id = ${linkedId}
        AND organization_id = ${organizationId}
      RETURNING id
    `;
    linkedId = linked[0]?.id ?? linkedId;
  } else {
    const linked = await prisma.$queryRaw<ConnectionIdRow[]>`
      INSERT INTO messenger_connections
        (id, organization_id, channel, type, client_id, external_user_id, external_chat_id, external_username,
         display_name, is_active, linked_at, last_seen_at, blocked_at, raw_json, updated_at)
      VALUES
        (${connectionId}, ${organizationId}, 'telegram', 'client', ${row.clientId}, ${event.externalUserId ?? null}, ${event.externalConversationId},
         ${event.externalUsername ?? null}, ${displayName}, true, now(), ${event.createdAt}, NULL, ${JSON.stringify(rawJson)}::jsonb, now())
      ON CONFLICT (channel, external_chat_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        type = 'client',
        client_id = EXCLUDED.client_id,
        external_user_id = COALESCE(EXCLUDED.external_user_id, messenger_connections.external_user_id),
        external_username = EXCLUDED.external_username,
        display_name = EXCLUDED.display_name,
        is_active = true,
        linked_at = COALESCE(messenger_connections.linked_at, now()),
        last_seen_at = EXCLUDED.last_seen_at,
        blocked_at = NULL,
        raw_json = EXCLUDED.raw_json,
        updated_at = now()
      RETURNING id
    `;
    linkedId = linked[0]?.id ?? connectionId;
  }

  await prisma.$executeRaw`
    UPDATE messenger_connections
    SET is_active = false,
        updated_at = now()
    WHERE channel = 'telegram'
      AND organization_id = ${organizationId}
      AND type = 'client'
      AND client_id = ${row.clientId}
      AND id <> ${linkedId}
  `;

  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET connection_id = ${linkedId},
        client_id = ${row.clientId},
        status = 'open',
        updated_at = now()
    WHERE channel = 'telegram'
      AND organization_id = ${organizationId}
      AND external_conversation_id = ${event.externalConversationId}
  `;

  return { ok: true as const, clientId: row.clientId, connectionId: linkedId };
}

export async function linkTelegramEmployeeFromStartToken(token: string, event: IncomingMessageEvent) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<LinkTokenRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      token,
      channel,
      type,
      client_id AS "clientId",
      employee_id AS "employeeId",
      expires_at AS "expiresAt",
      used_at AS "usedAt"
    FROM messenger_link_tokens
    WHERE token = ${token}
      AND organization_id = ${organizationId}
      AND channel = 'telegram'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.type !== "employee" || !row.employeeId) return { ok: false as const, reason: "not_found" as const };
  const reserved = await reserveLinkToken(row);
  if (!reserved.ok) return reserved;

  const connectionId = crypto.randomUUID();
  const displayName = [event.firstName, event.lastName].filter(Boolean).join(" ") || event.participantName;
  const rawJson = {
    source: "telegram_employee_start_link",
    firstName: event.firstName,
    lastName: event.lastName,
    username: event.externalUsername,
    update: event.raw,
  };

  const reusableByChat = await prisma.$queryRaw<ConnectionIdRow[]>`
    SELECT id
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND external_chat_id = ${event.externalConversationId}
    LIMIT 1
  `;
  const reusableByEmployee = await prisma.$queryRaw<ConnectionIdRow[]>`
    SELECT id
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND type = 'employee'
      AND employee_id = ${row.employeeId}
    ORDER BY is_active DESC, linked_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;

  let linkedId = reusableByChat[0]?.id ?? reusableByEmployee[0]?.id ?? null;

  if (linkedId) {
    const linked = await prisma.$queryRaw<ConnectionIdRow[]>`
      UPDATE messenger_connections
      SET type = 'employee',
          client_id = NULL,
          employee_id = ${row.employeeId},
          supplier_id = NULL,
          external_user_id = COALESCE(${event.externalUserId ?? null}, external_user_id),
          external_chat_id = ${event.externalConversationId},
          external_username = ${event.externalUsername ?? null},
          display_name = ${displayName},
          is_active = true,
          linked_at = COALESCE(linked_at, now()),
          last_seen_at = ${event.createdAt},
          blocked_at = NULL,
          raw_json = ${JSON.stringify(rawJson)}::jsonb,
          updated_at = now()
      WHERE id = ${linkedId}
        AND organization_id = ${organizationId}
      RETURNING id
    `;
    linkedId = linked[0]?.id ?? linkedId;
  } else {
    const linked = await prisma.$queryRaw<ConnectionIdRow[]>`
      INSERT INTO messenger_connections
        (id, organization_id, channel, type, employee_id, external_user_id, external_chat_id, external_username,
         display_name, is_active, linked_at, last_seen_at, blocked_at, raw_json, updated_at)
      VALUES
        (${connectionId}, ${organizationId}, 'telegram', 'employee', ${row.employeeId}, ${event.externalUserId ?? null}, ${event.externalConversationId},
         ${event.externalUsername ?? null}, ${displayName}, true, now(), ${event.createdAt}, NULL, ${JSON.stringify(rawJson)}::jsonb, now())
      ON CONFLICT (channel, external_chat_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        type = 'employee',
        client_id = NULL,
        employee_id = EXCLUDED.employee_id,
        supplier_id = NULL,
        external_user_id = COALESCE(EXCLUDED.external_user_id, messenger_connections.external_user_id),
        external_username = EXCLUDED.external_username,
        display_name = EXCLUDED.display_name,
        is_active = true,
        linked_at = COALESCE(messenger_connections.linked_at, now()),
        last_seen_at = EXCLUDED.last_seen_at,
        blocked_at = NULL,
        raw_json = EXCLUDED.raw_json,
        updated_at = now()
      RETURNING id
    `;
    linkedId = linked[0]?.id ?? connectionId;
  }

  await prisma.$executeRaw`
    UPDATE messenger_connections
    SET is_active = false,
        updated_at = now()
    WHERE channel = 'telegram'
      AND organization_id = ${organizationId}
      AND type = 'employee'
      AND employee_id = ${row.employeeId}
      AND id <> ${linkedId}
  `;

  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET connection_id = ${linkedId},
        client_id = NULL,
        employee_id = ${row.employeeId},
        status = 'open',
        updated_at = now()
    WHERE channel = 'telegram'
      AND organization_id = ${organizationId}
      AND external_conversation_id = ${event.externalConversationId}
  `;

  return { ok: true as const, employeeId: row.employeeId, connectionId: linkedId };
}
