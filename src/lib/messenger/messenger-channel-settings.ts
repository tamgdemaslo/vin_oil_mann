import crypto from "crypto";
import { prisma } from "@/lib/db";
import { decryptIntegrationSecret, encryptedIntegrationSecretJson } from "./messenger-crypto";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationId } from "./messenger-tenant";
import type { MessengerConnectionStatus } from "./messenger-types";

type ChannelSettingRow = {
  channel: string;
  organizationId?: string;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  secretsJson: Record<string, unknown> | null;
  updatedAt: Date;
};

type CredentialRow = {
  id: string;
  key: string;
  encryptedValue: unknown;
};

export type TelegramStoredSettings = {
  enabled: boolean;
  dryRun: boolean;
  botUsername: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  botToken: string | null;
  configured: boolean;
  source: "db" | "env" | "empty";
  updatedAt?: string | null;
};

const SETTINGS_ENCRYPTION_VERSION = 1;

function encryptionKey() {
  const source = [
    process.env.MESSENGER_SETTINGS_SECRET,
    process.env.SESSION_SECRET,
    process.env.AUTH_SALT,
    "eco-messenger-settings",
  ]
    .filter(Boolean)
    .join(":");
  return crypto.createHash("sha256").update(source).digest();
}

function decryptSecret(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const item = payload as { v?: unknown; alg?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (item.v !== SETTINGS_ENCRYPTION_VERSION || item.alg !== "aes-256-gcm") return null;
  if (typeof item.iv !== "string" || typeof item.tag !== "string" || typeof item.data !== "string") return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(item.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(item.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(item.data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function envTelegramSettings(): TelegramStoredSettings {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null;
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim() || null;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  const enabled = process.env.TELEGRAM_ENABLED === "true";
  return {
    enabled,
    dryRun: process.env.TELEGRAM_DRY_RUN === "true",
    botUsername,
    webhookUrl,
    webhookSecret,
    botToken,
    configured: Boolean(botToken),
    source: botToken || botUsername || webhookUrl || webhookSecret || enabled ? "env" : "empty",
  };
}

function mergeWithEnvAndCredentials(row: ChannelSettingRow | null, credentials: Record<string, string | null>): TelegramStoredSettings {
  const env = envTelegramSettings();
  if (!row) return env;
  const config = row.configJson ?? {};
  const secrets = row.secretsJson ?? {};
  const botToken = credentials.botToken ?? decryptSecret(secrets.botToken) ?? env.botToken;
  const webhookSecret = credentials.webhookSecret ?? decryptSecret(secrets.webhookSecret) ?? env.webhookSecret;
  return {
    enabled: row.enabled,
    dryRun: boolValue(config.dryRun, env.dryRun),
    botUsername: stringValue(config.botUsername) ?? env.botUsername,
    webhookUrl: stringValue(config.webhookUrl) ?? env.webhookUrl,
    webhookSecret,
    botToken,
    configured: Boolean(botToken),
    source: "db",
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readTelegramCredentials() {
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<CredentialRow[]>`
    SELECT
      id,
      key,
      encrypted_value AS "encryptedValue"
    FROM integration_credentials
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND key IN ('botToken', 'webhookSecret')
    ORDER BY rotated_at DESC NULLS LAST, updated_at DESC, created_at DESC
  `;
  const result: Record<string, string | null> = {};
  for (const row of rows) {
    if (result[row.key] !== undefined) continue;
    result[row.key] = decryptIntegrationSecret(row.encryptedValue);
  }
  return result;
}

async function upsertTelegramCredential(key: "botToken" | "webhookSecret", value: string, updatedById?: string | null) {
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM integration_credentials
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND key = ${key}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `;
  const encryptedValue = encryptedIntegrationSecretJson(value);
  const existingId = rows[0]?.id;
  if (existingId) {
    await prisma.$executeRaw`
      UPDATE integration_credentials
      SET encrypted_value = ${encryptedValue}::jsonb,
          metadata_json = jsonb_build_object('source', 'legacy_bot_settings'),
          rotated_at = now(),
          updated_at = now()
      WHERE id = ${existingId}
        AND organization_id = ${organizationId}
    `;
    return;
  }
  await prisma.$executeRaw`
    INSERT INTO integration_credentials
      (id, organization_id, channel, key, encrypted_value, metadata_json, created_by_id, rotated_at, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${organizationId}, 'telegram', ${key}, ${encryptedValue}::jsonb,
       jsonb_build_object('source', 'legacy_bot_settings'), ${updatedById ?? null}, now(), now(), now())
  `;
}

export async function getTelegramStoredSettings(): Promise<TelegramStoredSettings> {
  try {
    await ensureMessengerIntegrationCoreSchema();
    const organizationId = getMessengerOrganizationId();
    const rows = await prisma.$queryRaw<ChannelSettingRow[]>`
      SELECT
        channel,
        organization_id AS "organizationId",
        enabled,
        config_json AS "configJson",
        secrets_json AS "secretsJson",
        updated_at AS "updatedAt"
      FROM messenger_channel_settings
      WHERE organization_id = ${organizationId}
        AND channel = 'telegram'
      LIMIT 1
    `;
    return mergeWithEnvAndCredentials(rows[0] ?? null, await readTelegramCredentials());
  } catch (error) {
    if (error instanceof Error && error.message.includes("messenger_channel_settings")) return envTelegramSettings();
    throw error;
  }
}

export async function updateTelegramStoredSettings(input: {
  enabled?: boolean;
  dryRun?: boolean;
  botUsername?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  botToken?: string | null;
  updatedById?: string | null;
}) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const current = await getTelegramStoredSettings();
  const nextConfig = {
    botUsername: input.botUsername === undefined ? current.botUsername : stringValue(input.botUsername),
    webhookUrl: input.webhookUrl === undefined ? current.webhookUrl : stringValue(input.webhookUrl),
    dryRun: input.dryRun === undefined ? current.dryRun : Boolean(input.dryRun),
  };
  const nextBotToken = input.botToken === undefined ? current.botToken : stringValue(input.botToken) ?? current.botToken;
  const nextWebhookSecret =
    input.webhookSecret === undefined ? current.webhookSecret : stringValue(input.webhookSecret) ?? current.webhookSecret;
  if (nextBotToken && nextBotToken !== current.botToken) {
    await upsertTelegramCredential("botToken", nextBotToken, input.updatedById ?? null);
  }
  if (nextWebhookSecret && nextWebhookSecret !== current.webhookSecret) {
    await upsertTelegramCredential("webhookSecret", nextWebhookSecret, input.updatedById ?? null);
  }

  const rows = await prisma.$queryRaw<ChannelSettingRow[]>`
    INSERT INTO messenger_channel_settings
      (id, organization_id, channel, enabled, config_json, secrets_json, created_by_id, updated_by_id, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${organizationId}, 'telegram', ${input.enabled ?? current.enabled}, ${JSON.stringify(nextConfig)}::jsonb,
       '{}'::jsonb, ${input.updatedById ?? null}, ${input.updatedById ?? null}, now(), now())
    ON CONFLICT (channel)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      enabled = EXCLUDED.enabled,
      config_json = EXCLUDED.config_json,
      secrets_json = '{}'::jsonb,
      updated_by_id = EXCLUDED.updated_by_id,
      updated_at = now()
    RETURNING
      channel,
      organization_id AS "organizationId",
      enabled,
      config_json AS "configJson",
      secrets_json AS "secretsJson",
      updated_at AS "updatedAt"
  `;
  return mergeWithEnvAndCredentials(rows[0] ?? null, await readTelegramCredentials());
}

export function publicTelegramSettings(settings: TelegramStoredSettings) {
  const connectionStatus: MessengerConnectionStatus = !settings.enabled
    ? "disabled"
    : settings.dryRun
      ? "dry_run"
      : settings.configured
        ? "connected"
        : "not_connected";
  return {
    enabled: settings.enabled,
    dryRun: settings.dryRun,
    configured: settings.configured,
    botUsername: settings.botUsername,
    webhookUrl: settings.webhookUrl,
    hasWebhookSecret: Boolean(settings.webhookSecret),
    connectionStatus,
    source: settings.source,
    updatedAt: settings.updatedAt ?? null,
  };
}
