import crypto from "crypto";
import { prisma } from "@/lib/db";
import type { User } from "@/lib/auth";
import {
  disconnectTelegramUserAccount,
  getTelegramUserRuntimeConfig,
  listTelegramUserAccounts,
  syncTelegramUserAccount,
  telegramUserSessionAdapter,
} from "./channels/telegram-user-session";
import { listMessengerChannels } from "./messenger-gateway";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationIdForUser } from "./messenger-tenant";
import type {
  IntegrationChannelCard,
  IntegrationOnboardingSession,
  MessengerAccount,
  MessengerCapabilityStatus,
  MessengerChannel,
  MessengerChannelCapabilities,
} from "./messenger-types";

export const integrationMessengerChannels = ["telegram", "whatsapp", "vk", "avito", "max", "sms"] as const;
export type IntegrationMessengerChannel = (typeof integrationMessengerChannels)[number];

export const channelCapabilities: Record<IntegrationMessengerChannel, MessengerChannelCapabilities> = {
  telegram: {
    channel: "telegram",
    allowedMode: "Рабочий Telegram-аккаунт / User Session / MTProto",
    inbound: "Supported",
    outbound: "Supported",
    realtime: "Partially supported",
    access: "Supported",
    summary: "Единственный рабочий канал этапа 1. Клиент ничего не делает; владелец подключает рабочий аккаунт.",
    docsUrl: "/docs/messenger-channel-capabilities.md#telegram",
  },
  whatsapp: {
    channel: "whatsapp",
    allowedMode: "WhatsApp Business Platform / Embedded Signup",
    inbound: "Partially supported",
    outbound: "Partially supported",
    realtime: "Supported",
    access: "Requires approval",
    summary: "Только официальный WABA/Cloud API. Личные WhatsApp-сессии и ручные env для tenant запрещены.",
    docsUrl: "/docs/messenger-channel-capabilities.md#matrix",
  },
  vk: {
    channel: "vk",
    allowedMode: "Сообщения сообщества через официальный VK API",
    inbound: "Supported",
    outbound: "Partially supported",
    realtime: "Supported",
    access: "Requires approval",
    summary: "Только community messages. Личные аккаунты, пароли и scraping запрещены.",
    docsUrl: "/docs/messenger-channel-capabilities.md#matrix",
  },
  avito: {
    channel: "avito",
    allowedMode: "Официальный Avito API / OAuth",
    inbound: "Partially supported",
    outbound: "Partially supported",
    realtime: "Requires approval",
    access: "Requires approval",
    summary: "Подключение после подтверждения доступа к Avito messenger API.",
    docsUrl: "/docs/messenger-channel-capabilities.md#matrix",
  },
  max: {
    channel: "max",
    allowedMode: "MAX Bot API",
    inbound: "Partially supported",
    outbound: "Supported",
    realtime: "Supported",
    access: "Requires approval",
    summary: "Планируется как bot adapter: Authorization header, HTTPS webhook production-only, 30 rps limit.",
    docsUrl: "https://dev.max.ru/docs-api",
  },
  sms: {
    channel: "sms",
    allowedMode: "Провайдер SMS после отдельного аудита",
    inbound: "Partially supported",
    outbound: "Supported",
    realtime: "Partially supported",
    access: "Requires approval",
    summary: "Провайдер не выбран. Перед адаптером нужен аудит 2-3 провайдеров РФ.",
    docsUrl: "/docs/messenger-channel-capabilities.md#matrix",
  },
};

type OnboardingSessionRow = {
  id: string;
  organizationId: string;
  channel: MessengerChannel;
  providerKey: string | null;
  messengerAccountId: string | null;
  status: string;
  currentStep: string;
  dataJson: Record<string, unknown>;
  errorMessage: string | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function assertIntegrationChannel(channel: string): IntegrationMessengerChannel {
  if ((integrationMessengerChannels as readonly string[]).includes(channel)) return channel as IntegrationMessengerChannel;
  throw new Error("Канал не поддерживается Messenger Gateway.");
}

function capabilityHealth(capability: MessengerChannelCapabilities): MessengerCapabilityStatus {
  if (capability.channel === "telegram") return "Supported";
  if (capability.access === "Requires approval") return "Requires approval";
  return capability.outbound;
}

function toOnboardingSession(row: OnboardingSessionRow): IntegrationOnboardingSession {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: row.channel,
    providerKey: row.providerKey,
    messengerAccountId: row.messengerAccountId,
    status: row.status,
    currentStep: row.currentStep,
    dataJson: row.dataJson ?? {},
    errorMessage: row.errorMessage,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listIntegrationMessengerChannels(user?: User | null): Promise<IntegrationChannelCard[]> {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationIdForUser(user);
  const [channels, telegramAccounts] = await Promise.all([listMessengerChannels(), listTelegramUserAccounts()]);
  const channelByKey = new Map(channels.map((channel) => [channel.key, channel]));
  const activeTelegram =
    telegramAccounts.find((account) => account.organizationId === organizationId && account.status === "connected" && account.isActive) ??
    telegramAccounts.find((account) => account.status === "connected" && account.isActive) ??
    telegramAccounts[0] ??
    null;

  return integrationMessengerChannels.map((key) => {
    const base = channelByKey.get(key);
    const capabilities = channelCapabilities[key];
    const account = key === "telegram" ? activeTelegram : null;
    const connected = account?.status === "connected" && account.isActive;
    const planned = key !== "telegram";
    return {
      key,
      label: base?.label ?? key,
      icon: base?.icon ?? "messages-square",
      color: base?.color ?? "#737373",
      enabled: key === "telegram" ? Boolean(base?.enabled) : false,
      connectionStatus: connected ? "connected" : planned ? "disabled" : base?.connectionStatus ?? "not_connected",
      adapterStatus: key === "telegram" ? "real" : "planned",
      connection: base?.connection,
      capabilityStatus: capabilityHealth(capabilities),
      capabilitySummary: capabilities.summary,
      allowedMode: capabilities.allowedMode,
      docsUrl: capabilities.docsUrl,
      account,
      onboardingMode: key === "telegram" ? "active" : "audit_required",
      healthStatus: connected ? "connected" : planned ? "planned" : account?.status === "needs_auth" ? "needs_auth" : account?.status === "error" ? "error" : "disabled",
      primaryAction: key === "telegram" ? (account?.status === "needs_auth" ? "reconnect" : "configure") : "coming_soon",
    };
  });
}

export async function listIntegrationMessengerAccounts(user?: User | null): Promise<MessengerAccount[]> {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationIdForUser(user);
  return (await listTelegramUserAccounts()).filter((account) => (account.organizationId ?? organizationId) === organizationId);
}

export async function startIntegrationOnboarding(channelInput: string, user: User) {
  await ensureMessengerIntegrationCoreSchema();
  const channel = assertIntegrationChannel(channelInput);
  const organizationId = getMessengerOrganizationIdForUser(user);
  if (channel === "telegram") {
    const config = await getTelegramUserRuntimeConfig();
    return {
      ok: true as const,
      channel,
      status: "ready",
      nextStep: "telegram_user_session_settings",
      endpoints: {
        startAuth: "/api/messenger/telegram-user/start-auth",
        startQr: "/api/messenger/telegram-user/start-qr",
        confirmCode: "/api/messenger/telegram-user/confirm-code",
        confirmPassword: "/api/messenger/telegram-user/confirm-password",
      },
      config,
    };
  }

  const id = crypto.randomUUID();
  const capabilities = channelCapabilities[channel];
  const dataJson = {
    capabilities,
    message: "Канал пока находится в capability audit. Подключение будет включено после утверждения официального сценария.",
  };
  const rows = await prisma.$queryRaw<OnboardingSessionRow[]>`
    INSERT INTO integration_onboarding_sessions
      (id, organization_id, channel, provider_key, status, current_step, data_json, created_by_id, expires_at, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, ${channel}, ${channel}, 'awaiting_audit', 'capability_audit',
       ${JSON.stringify(dataJson)}::jsonb, ${user.login}, now() + interval '1 day', now(), now())
    RETURNING
      id,
      organization_id AS "organizationId",
      channel,
      provider_key AS "providerKey",
      messenger_account_id AS "messengerAccountId",
      status,
      current_step AS "currentStep",
      data_json AS "dataJson",
      error_message AS "errorMessage",
      expires_at AS "expiresAt",
      completed_at AS "completedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  await writeIntegrationAudit({
    organizationId,
    channel,
    actorId: user.login,
    action: "onboarding.start",
    status: "planned",
    message: `${channel} onboarding is awaiting capability audit`,
    metadataJson: dataJson,
  });
  return { ok: true as const, session: toOnboardingSession(rows[0]), status: "awaiting_audit", nextStep: "capability_audit" };
}

export async function getIntegrationOnboardingSession(sessionId: string, user?: User | null) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationIdForUser(user);
  const rows = await prisma.$queryRaw<OnboardingSessionRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      channel,
      provider_key AS "providerKey",
      messenger_account_id AS "messengerAccountId",
      status,
      current_step AS "currentStep",
      data_json AS "dataJson",
      error_message AS "errorMessage",
      expires_at AS "expiresAt",
      completed_at AS "completedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM integration_onboarding_sessions
    WHERE id = ${sessionId}
      AND organization_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ? toOnboardingSession(rows[0]) : null;
}

export async function completeIntegrationOnboarding(channelInput: string, _body: Record<string, unknown>, user: User) {
  await ensureMessengerIntegrationCoreSchema();
  const channel = assertIntegrationChannel(channelInput);
  if (channel === "telegram") {
    return {
      ok: false as const,
      status: "use_telegram_user_session_routes",
      error: "Telegram подключается через экран рабочего аккаунта: номер/код/2FA или QR владельца.",
    };
  }
  await writeIntegrationAudit({
    organizationId: getMessengerOrganizationIdForUser(user),
    channel,
    actorId: user.login,
    action: "onboarding.complete",
    status: "blocked",
    message: "Adapter is planned and disabled",
    metadataJson: channelCapabilities[channel],
  });
  return {
    ok: false as const,
    status: "awaiting_audit",
    error: "Канал пока недоступен: сначала нужно утвердить capability matrix и официальный сценарий подключения.",
  };
}

export async function testIntegrationMessengerAccount(accountId: string, user?: User | null) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationIdForUser(user);
  const accounts = await listIntegrationMessengerAccounts(user ?? null);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return { ok: false as const, error: "Messenger account не найден." };
  if (account.channel !== "telegram") return { ok: false as const, error: "Тест доступен только для Telegram на этапе 1." };
  const result = await telegramUserSessionAdapter.validateConfig?.();
  await writeIntegrationAudit({
    organizationId,
    channel: account.channel,
    messengerAccountId: account.id,
    actorId: user?.login ?? null,
    action: "account.test",
    status: result?.ok ? "ok" : "error",
    message: result?.ok ? "Telegram connection is healthy" : result?.error ?? "Telegram connection test failed",
    metadataJson: { status: result?.status },
  });
  return result ?? { ok: false as const, error: "Telegram adapter не вернул статус." };
}

export async function disconnectIntegrationMessengerAccount(accountId: string, user: User) {
  await ensureMessengerIntegrationCoreSchema();
  const accounts = await listIntegrationMessengerAccounts(user);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return { ok: false as const, error: "Messenger account не найден." };
  if (account.channel !== "telegram") return { ok: false as const, error: "Отключение planned-канала недоступно." };
  const result = await disconnectTelegramUserAccount(accountId);
  await writeIntegrationAudit({
    organizationId: getMessengerOrganizationIdForUser(user),
    channel: account.channel,
    messengerAccountId: account.id,
    actorId: user.login,
    action: "account.disconnect",
    status: result.ok ? "ok" : "error",
    message: result.ok ? "Telegram account disconnected" : "Telegram disconnect failed",
  });
  return result;
}

export async function getIntegrationMessengerAccountHealth(accountId: string, user?: User | null) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationIdForUser(user);
  const accounts = await listIntegrationMessengerAccounts(user ?? null);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return null;
  const rows = await prisma.$queryRaw<Array<{ failedOutbox: number; queuedOutbox: number; conversations: number; messages: number }>>`
    SELECT
      COUNT(mo.id) FILTER (WHERE mo.status = 'failed')::int AS "failedOutbox",
      COUNT(mo.id) FILTER (WHERE mo.status = 'queued')::int AS "queuedOutbox",
      COUNT(DISTINCT mc.id)::int AS "conversations",
      COUNT(DISTINCT mm.id)::int AS "messages"
    FROM messenger_accounts ma
    LEFT JOIN messenger_conversations mc ON mc.messenger_account_id = ma.id AND mc.organization_id = ma.organization_id
    LEFT JOIN messenger_messages mm ON mm.conversation_id = mc.id AND mm.organization_id = ma.organization_id
    LEFT JOIN messenger_outbox mo ON mo.messenger_account_id = ma.id AND mo.organization_id = ma.organization_id
    WHERE ma.id = ${accountId}
      AND ma.organization_id = ${organizationId}
    GROUP BY ma.id
  `;
  return {
    ok: true as const,
    account,
    health: {
      status: account.status,
      failedOutbox: rows[0]?.failedOutbox ?? 0,
      queuedOutbox: rows[0]?.queuedOutbox ?? 0,
      conversations: rows[0]?.conversations ?? account.conversationCount ?? 0,
      messages: rows[0]?.messages ?? 0,
      lastSyncAt: account.lastSyncAt ?? null,
      errorMessage: account.errorMessage ?? null,
    },
  };
}

export async function syncIntegrationMessengerAccount(accountId: string, user?: User | null) {
  await ensureMessengerIntegrationCoreSchema();
  const account = (await listIntegrationMessengerAccounts(user ?? null)).find((item) => item.id === accountId);
  if (!account) return { ok: false as const, error: "Messenger account не найден." };
  if (account.channel !== "telegram") return { ok: false as const, error: "Синхронизация planned-канала недоступна." };
  return syncTelegramUserAccount(accountId, 200);
}

async function writeIntegrationAudit(input: {
  organizationId: string;
  channel?: string | null;
  messengerAccountId?: string | null;
  actorId?: string | null;
  action: string;
  status?: string;
  message?: string | null;
  metadataJson?: Record<string, unknown>;
}) {
  await prisma.$executeRaw`
    INSERT INTO integration_audit_logs
      (id, organization_id, channel, messenger_account_id, actor_id, action, status, message, metadata_json, created_at)
    VALUES
      (${crypto.randomUUID()}, ${input.organizationId}, ${input.channel ?? null}, ${input.messengerAccountId ?? null},
       ${input.actorId ?? null}, ${input.action}, ${input.status ?? "ok"}, ${input.message ?? null},
       ${JSON.stringify(input.metadataJson ?? {})}::jsonb, now())
  `;
}
