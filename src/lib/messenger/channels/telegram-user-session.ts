import crypto from "crypto";
import { touchClientCaseMessageState } from "@/lib/client-case-workflow";
import { prisma } from "@/lib/db";
import type { Attachment, MessageOutbox, MessengerAccount, MessengerAccountStatus, MessengerConnection } from "../messenger-types";
import { enqueueMessengerMediaJob, refreshMessageAttachmentsJson } from "../messenger-media";
import { isPhotoAttachmentType, messengerAttachmentDisplayName } from "../messenger-attachment-normalization";
import { ensureMessengerIntegrationCoreSchema } from "../messenger-schema";
import { assertIntegrationEncryptionConfigured } from "../messenger-crypto";
import {
  messengerObjectKey,
  messengerStorageProxyUrl,
  messengerStorageStatus,
  putMessengerStorageObject,
  getMessengerStorageObject,
  safeStorageFileName,
} from "../messenger-storage";
import { getMessengerOrganizationId } from "../messenger-tenant";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";
import { resolveTelegramUserCredentials } from "@/lib/telegram-user-integration";
import { hasConsecutiveIntegrationFailures, notifyIntegrationOwner, recordIntegrationAudit } from "@/lib/integration-owner-notifications";
import type { ChannelSendResult, MessengerChannelAdapter } from "./types";

type SecretPayload = {
  v?: unknown;
  alg?: unknown;
  iv?: unknown;
  tag?: unknown;
  data?: unknown;
};

type TelegramAccountRow = {
  id: string;
  organizationId: string;
  channel: "telegram";
  mode: "user_session";
  displayName: string;
  phone: string | null;
  username: string | null;
  isActive: boolean;
  status: MessengerAccountStatus;
  lastSyncAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  conversationCount?: number;
};

type TelegramSessionRow = {
  id: string;
  messengerAccountId: string;
  phone: string;
  apiIdEncrypted: SecretPayload | null;
  apiHashEncrypted: SecretPayload | null;
  sessionEncrypted: SecretPayload | null;
  phoneCodeHashEncrypted: SecretPayload | null;
  qrTokenEncrypted: SecretPayload | null;
  qrExpiresAt: Date | null;
  authAttemptId: string | null;
  authDcId: string | null;
  authDeliveryType: string | null;
  authNextType: string | null;
  authTimeout: number | null;
  authExpiresAt: Date | null;
  status: MessengerAccountStatus;
  lastAuthorizedAt: Date | null;
  lastSyncAt: Date | null;
  errorMessage: string | null;
};

type TelegramCodeDelivery = {
  type: string;
  label: string;
  nextType: string | null;
  timeout: number | null;
  codeLength: number | null;
};

type TelegramPeer = {
  id?: unknown;
  userId?: unknown;
  channelId?: unknown;
  chatId?: unknown;
  className?: string;
};

type TelegramPeerSnapshot = {
  id?: string | null;
  chatId?: string | null;
  accessHash?: string | null;
  type?: "user" | "chat" | "channel" | null;
  username?: string | null;
  phone?: string | null;
  className?: string | null;
  inputClassName?: string | null;
};

type TelegramDialog = {
  id?: unknown;
  title?: string;
  name?: string;
  unreadCount?: number;
  archived?: boolean;
  folderId?: number | null;
  isArchived?: boolean;
  isChannel?: boolean;
  isGroup?: boolean;
  isUser?: boolean;
  inputEntity?: unknown;
  dialog?: {
    peer?: TelegramPeer | unknown;
    folderId?: number | null;
  };
  entity?: {
    id?: unknown;
    username?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    title?: string;
    photo?: unknown;
    bot?: boolean;
    broadcast?: boolean;
    megagroup?: boolean;
    gigagroup?: boolean;
    className?: string;
  };
  message?: TelegramMessage;
};

type TelegramMessage = {
  id?: unknown;
  message?: string;
  text?: string;
  date?: number | Date;
  out?: boolean;
  senderId?: unknown;
  peerId?: TelegramPeer | unknown;
  media?: unknown;
  groupedId?: unknown;
};

type TelegramRuntimeClient = {
  connect(): Promise<void>;
  setLogLevel?: (level: "none" | "error" | "warn" | "info" | "debug") => void;
  disconnect?: () => Promise<void>;
  destroy?: () => Promise<void>;
  invoke(input: unknown): Promise<unknown>;
  addEventHandler?: (callback: (update: unknown) => void) => void;
  getMe?: () => Promise<unknown>;
  getInputEntity?: (entity: unknown) => Promise<unknown>;
  isUserAuthorized?: () => Promise<boolean>;
  getDialogs(input: { limit: number }): Promise<unknown>;
  getMessages(entity: unknown, input: { limit?: number; ids?: number | number[] }): Promise<unknown>;
  sendMessage(entity: unknown, input: { message: string; linkPreview?: boolean; formattingEntities?: unknown[] }): Promise<{ id?: unknown }>;
  sendFile?(entity: unknown, input: { file: Buffer | string; caption?: string; forceDocument?: boolean; fileSize?: number; workers?: number }): Promise<{ id?: unknown }>;
  downloadMedia?: (messageOrMedia: unknown, input?: Record<string, unknown>) => Promise<string | Buffer | undefined>;
  downloadProfilePhoto?: (entity: unknown, input?: { isBig?: boolean }) => Promise<string | Buffer | undefined>;
  session?: { save?: () => string };
  getDC?: (dcId: number, downloadDC?: boolean, web?: boolean) => Promise<TelegramDcAddress>;
};

type TelegramStringSession = {
  dcId: number;
  setDC(dcId: number, serverAddress: string, port: number): void;
};

type TelegramDcAddress = {
  id: number;
  ipAddress: string;
  port: number;
};

type GramJsModule = {
  TelegramClient: new (session: unknown, apiId: number, apiHash: string, options: Record<string, unknown>) => unknown;
  StringSession: new (session: string) => TelegramStringSession;
  PromisedWebSockets: new () => unknown;
  Api: {
    auth: {
      SendCode: new (input: Record<string, unknown>) => unknown;
      ResendCode: new (input: Record<string, unknown>) => unknown;
      SignIn: new (input: Record<string, unknown>) => unknown;
      CheckPassword: new (input: Record<string, unknown>) => unknown;
      ExportLoginToken: new (input: Record<string, unknown>) => unknown;
      ImportLoginToken: new (input: Record<string, unknown>) => unknown;
    };
    account: {
      GetPassword: new () => unknown;
    };
    contacts: {
      ResolvePhone: new (input: Record<string, unknown>) => unknown;
      ImportContacts: new (input: Record<string, unknown>) => unknown;
    };
    InputPeerUser: new (input: Record<string, unknown>) => unknown;
    InputPeerChat: new (input: Record<string, unknown>) => unknown;
    InputPeerChannel: new (input: Record<string, unknown>) => unknown;
    InputPhoneContact: new (input: Record<string, unknown>) => unknown;
    MessageEntityBold: new (input: Record<string, unknown>) => unknown;
    MessageEntityTextUrl: new (input: Record<string, unknown>) => unknown;
    CodeSettings: new (input: Record<string, unknown>) => unknown;
  };
  Password: {
    computeCheck(request: unknown, password: string): Promise<unknown>;
  };
  version?: string;
};

const ENCRYPTION_VERSION = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_RETRIES = 1;
const DEFAULT_WORKER_LEASE_MS = 30 * 60_000;
const TELEGRAM_WEB_DC_NAMES: Record<number, string> = {
  1: "pluto",
  2: "venus",
  3: "aurora",
  4: "vesta",
  5: "flora",
};
// GramJS uses raw TCP in Node.js by default. Existing sessions were previously
// saved with *.web.telegram.org addresses for WSS, so switching transports
// also requires restoring a raw MTProto endpoint for the session DC.
const TELEGRAM_TCP_DC_ADDRESSES: Record<number, string> = {
  1: "149.154.175.53",
  2: "149.154.167.51",
  3: "149.154.175.100",
  4: "149.154.167.91",
  5: "91.108.56.130",
};
const TELEGRAM_SYNC_WORKER_OWNER = `${process.env.HOSTNAME?.trim() || "telegram-worker"}:${process.pid}:${crypto.randomUUID()}`;
let schemaEnsurePromise: Promise<void> | null = null;

type TelegramQrRuntimeAttempt = {
  accountId: string;
  sessionId: string;
  branchId: string;
  userId: string | null;
  phone: string | null;
  client: TelegramRuntimeClient;
  apiId: number;
  apiHash: string;
  attemptId: string;
  expiresAt: Date;
  tokenBase64: string;
  loginUrl: string;
  qrImageDataUrl: string;
  status: "pending" | "connected" | "waiting_password" | "error";
  account?: MessengerAccount;
  error?: string;
  finalizing?: Promise<void>;
};

type TelegramResolvedPeer = {
  accountId: string;
  organizationId: string;
  externalUserId: string;
  externalConversationId: string;
  chatId: string;
  username: string | null;
  displayName: string;
  phone: string | null;
  source: "phone_lookup" | "imported_contact";
  conversationId: string;
};

const qrRuntimeAttempts = new Map<string, TelegramQrRuntimeAttempt>();

function currentQrScope() {
  const tenant = getRequestTenant();
  return { branchId: getScopedBranchId(), userId: tenant?.userId ?? null };
}

function encryptionKey() {
  const configured = [
    process.env.MESSENGER_CREDENTIAL_ENCRYPTION_KEY,
    process.env.TELEGRAM_SESSION_ENCRYPTION_KEY,
    process.env.MESSENGER_SETTINGS_SECRET,
    process.env.SESSION_SECRET,
    process.env.AUTH_SALT,
  ]
    .filter(Boolean)
    .join(":");
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("В production не настроен master-key шифрования Telegram session");
  }
  const source = configured || "eco-telegram-user-session";
  return crypto.createHash("sha256").update(source).digest();
}

function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: ENCRYPTION_VERSION,
    alg: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: encrypted.toString("base64url"),
  };
}

function encryptedJson(value: string) {
  return JSON.stringify(encryptSecret(value));
}

function decryptSecret(payload: SecretPayload | null | undefined) {
  if (!payload || payload.v !== ENCRYPTION_VERSION || payload.alg !== "aes-256-gcm") return null;
  if (typeof payload.iv !== "string" || typeof payload.tag !== "string" || typeof payload.data !== "string") return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function normalizePhone(phone: string) {
  const compact = phone.replace(/[^\d+]/g, "").replace(/^00/, "+").trim();
  if (/^8\d{10}$/.test(compact)) return `+7${compact.slice(1)}`;
  if (/^7\d{10}$/.test(compact)) return `+${compact}`;
  return compact;
}

function telegramConnectTimeoutMs() {
  const configured = Number(process.env.TELEGRAM_CONNECT_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CONNECT_TIMEOUT_MS;
  return Math.max(5_000, Math.floor(configured));
}

function telegramConnectionRetries() {
  const configured = Number(process.env.TELEGRAM_CONNECTION_RETRIES);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_CONNECTION_RETRIES;
  return Math.floor(configured);
}

function telegramTransport() {
  const configured = process.env.TELEGRAM_TRANSPORT?.trim().toLowerCase();
  return configured === "websocket" || configured === "wss" ? "websocket" as const : "tcp" as const;
}

function telegramGramJsLogLevel(): "none" | "error" | "warn" | "info" | "debug" {
  const configured = process.env.TELEGRAM_GRAMJS_LOG_LEVEL?.trim().toLowerCase();
  if (configured === "error" || configured === "warn" || configured === "info" || configured === "debug") return configured;
  return "none";
}

function telegramWebDcAddress(dcId: number, downloadDC = false): TelegramDcAddress {
  const name = TELEGRAM_WEB_DC_NAMES[dcId];
  if (!name) throw new Error(`Telegram WebSocket не поддерживает DC ${dcId}.`);
  return {
    id: dcId,
    ipAddress: `${name}${downloadDC ? "-1" : ""}.web.telegram.org`,
    port: 443,
  };
}

function telegramTcpDcAddress(dcId: number): TelegramDcAddress {
  const ipAddress = TELEGRAM_TCP_DC_ADDRESSES[dcId];
  if (!ipAddress) throw new Error(`Telegram TCP не поддерживает DC ${dcId}.`);
  return { id: dcId, ipAddress, port: 443 };
}

type TelegramSocksProxy = {
  ip: string;
  port: number;
  socksType: 4 | 5;
  username?: string;
  password?: string;
};

function telegramSocksProxy(): TelegramSocksProxy | undefined {
  const ip = process.env.TELEGRAM_PROXY_HOST?.trim() ?? "";
  const rawPort = process.env.TELEGRAM_PROXY_PORT?.trim() ?? "";
  if (!ip && !rawPort) return undefined;

  const port = Number(rawPort);
  if (!ip || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Для Telegram SOCKS-прокси задайте TELEGRAM_PROXY_HOST и TELEGRAM_PROXY_PORT.");
  }

  const socksType = Number(process.env.TELEGRAM_PROXY_SOCKS_TYPE ?? "5");
  if (socksType !== 4 && socksType !== 5) {
    throw new Error("TELEGRAM_PROXY_SOCKS_TYPE может быть только 4 или 5.");
  }

  const username = process.env.TELEGRAM_PROXY_USERNAME?.trim() || undefined;
  const password = process.env.TELEGRAM_PROXY_PASSWORD?.trim() || undefined;
  if (Boolean(username) !== Boolean(password)) {
    throw new Error("Для Telegram SOCKS-прокси укажите одновременно логин и пароль.");
  }

  return { ip, port, socksType, ...(username && password ? { username, password } : {}) };
}

function redact(value: string) {
  return value.replace(/\b[0-9a-f]{32}\b/gi, "[TELEGRAM_API_HASH]");
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

function logCodeDelivery(action: "sendCode" | "resendCode", phone: string, delivery: TelegramCodeDelivery) {
  console.info("[messenger.telegram_user.auth]", {
    action,
    phone: maskPhone(phone),
    production: true,
    testServers: false,
    deliveryType: delivery.type,
    deliveryLabel: delivery.label,
    nextType: delivery.nextType,
    timeout: delivery.timeout,
    codeLength: delivery.codeLength,
  });
}

function logAuthState(action: string, phone: string, accountId?: string | null) {
  console.info("[messenger.telegram_user.auth]", {
    action,
    phone: maskPhone(phone),
    accountId: accountId ?? null,
  });
}

function logAuthAttempt(payload: Record<string, unknown>) {
  console.info("[messenger.telegram_user.auth]", {
    production: true,
    testServers: false,
    ...payload,
  });
}

function logSyncState(action: string, payload: Record<string, unknown>) {
  console.info("[messenger.telegram_user.sync]", {
    action,
    ...payload,
  });
}

async function loadGramJs(): Promise<GramJsModule> {
  try {
    const telegram = await import("telegram");
    const extensions = await import("telegram/extensions");
    const sessions = await import("telegram/sessions");
    return {
      TelegramClient: telegram.TelegramClient as GramJsModule["TelegramClient"],
      Api: telegram.Api as unknown as GramJsModule["Api"],
      StringSession: sessions.StringSession as GramJsModule["StringSession"],
      PromisedWebSockets: extensions.PromisedWebSockets as GramJsModule["PromisedWebSockets"],
      Password: telegram.password as GramJsModule["Password"],
      version: typeof telegram.version === "string" ? telegram.version : undefined,
    };
  } catch {
    throw new Error("MTProto client не установлен. Добавьте dependency `telegram` (GramJS) и задеплойте backend.");
  }
}

async function getClient(
  session = "",
  credentials?: { apiId: number; apiHash: string },
  options: { autoReconnect?: boolean } = {}
) {
  const { apiId, apiHash } = credentials ?? await resolveTelegramUserCredentials();
  const { TelegramClient, StringSession, PromisedWebSockets } = await loadGramJs();
  const proxy = telegramSocksProxy();
  const stringSession = new StringSession(session);
  const useWebSocket = !proxy && telegramTransport() === "websocket";
  const initialDc = useWebSocket
    ? telegramWebDcAddress(stringSession.dcId || 4)
    : telegramTcpDcAddress(stringSession.dcId || 4);
  stringSession.setDC(initialDc.id, initialDc.ipAddress, initialDc.port);
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: telegramConnectionRetries(),
    // Regular operations own a short-lived client and destroy it in finally.
    // Leaving GramJS auto-reconnect enabled lets it keep reconnecting after a
    // connect timeout, even though the owning operation has already failed.
    autoReconnect: options.autoReconnect ?? false,
    testServers: false,
    // When WSS is explicitly requested, GramJS needs both the WebSocket socket
    // implementation and a web DC hostname. Node.js otherwise uses raw TCP.
    useWSS: useWebSocket,
    ...(useWebSocket ? { networkSocket: PromisedWebSockets } : {}),
    ...(proxy ? { proxy } : {}),
  }) as TelegramRuntimeClient;
  // GramJS prints the complete WebSocket event (including its internal client
  // graph) on connection failures. Application-level errors below are enough
  // for diagnostics and keep production logs bounded.
  client.setLogLevel?.(telegramGramJsLogLevel());
  if (useWebSocket) {
    client.getDC = async (dcId, downloadDC = false) => telegramWebDcAddress(dcId, downloadDC);
  }
  try {
    await withTelegramConnectTimeout(client.connect(), telegramConnectTimeoutMs());
  } catch (error) {
    await disconnectTelegramClient(client);
    throw error;
  }
  return client;
}

async function withTelegramConnectTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Telegram connect timeout after ${timeoutMs}ms`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function disconnectTelegramClient(client: TelegramRuntimeClient) {
  const close = client.destroy ?? client.disconnect;
  if (!close) return;
  await close.call(client).catch((error) => {
    console.warn("[messenger.telegram_user.auth]", {
      action: "client_close_failed",
      error: safeError(error, "Telegram client close failed"),
    });
  });
}

function safeDisconnectTelegramClient(client: TelegramRuntimeClient) {
  void disconnectTelegramClient(client);
}

function statusToConnection(status?: MessengerAccountStatus): MessengerConnection["connectionStatus"] {
  if (status === "connected") return "connected";
  if (status === "error" || status === "needs_auth" || status === "degraded") return "error";
  return "not_connected";
}

function toPublicAccount(row: TelegramAccountRow): MessengerAccount {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: "telegram",
    mode: "user_session",
    displayName: row.displayName,
    phone: row.phone,
    username: row.username,
    isActive: row.isActive,
    enabled: row.isActive,
    status: row.status,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    conversationCount: Number(row.conversationCount ?? 0),
  };
}

function safeError(error: unknown, fallback = "Telegram user session failed") {
  return redact(error instanceof Error ? error.message : fallback);
}

async function ensureTelegramUserSchema() {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureMessengerIntegrationCoreSchema().catch((error) => {
      schemaEnsurePromise = null;
      throw error;
    });
  }
  await schemaEnsurePromise;
}

export async function listTelegramUserAccounts(): Promise<MessengerAccount[]> {
  try {
    await ensureTelegramUserSchema();
    const organizationId = getMessengerOrganizationId();
    const branchId = getScopedBranchId();
    const rows = await prisma.$queryRaw<TelegramAccountRow[]>`
      SELECT
        ma.id,
        ma.organization_id AS "organizationId",
        ma.channel,
        ma.mode,
        ma.display_name AS "displayName",
        ma.phone,
        ma.username,
        ma.is_active AS "isActive",
        ma.status,
        ma.last_sync_at AS "lastSyncAt",
        ma.error_message AS "errorMessage",
        ma.created_at AS "createdAt",
        ma.updated_at AS "updatedAt",
        COUNT(mc.id)::int AS "conversationCount"
      FROM messenger_accounts ma
      LEFT JOIN messenger_conversations mc ON mc.messenger_account_id = ma.id AND mc.organization_id = ma.organization_id AND mc.branch_id = ma.branch_id
      WHERE ma.organization_id = ${organizationId}
        AND ma.branch_id = ${branchId}
        AND ma.channel = 'telegram'
        AND ma.mode = 'user_session'
      GROUP BY ma.id
      ORDER BY ma.updated_at DESC
    `;
    return rows.map(toPublicAccount);
  } catch (error) {
    if (error instanceof Error && error.message.includes("messenger_accounts")) return [];
    throw error;
  }
}

export async function getActiveTelegramUserAccount() {
  const accounts = await listTelegramUserAccounts();
  return accounts.find((account) => account.isActive && account.status === "connected") ?? accounts[0] ?? null;
}

async function getSessionByAccount(accountId: string) {
  await ensureTelegramUserSchema();
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  const rows = await prisma.$queryRaw<TelegramSessionRow[]>`
    SELECT
      id,
      messenger_account_id AS "messengerAccountId",
      phone,
      api_id_encrypted AS "apiIdEncrypted",
      api_hash_encrypted AS "apiHashEncrypted",
      session_encrypted AS "sessionEncrypted",
      phone_code_hash_encrypted AS "phoneCodeHashEncrypted",
      qr_token_encrypted AS "qrTokenEncrypted",
      qr_expires_at AS "qrExpiresAt",
      auth_attempt_id AS "authAttemptId",
      auth_dc_id AS "authDcId",
      auth_delivery_type AS "authDeliveryType",
      auth_next_type AS "authNextType",
      auth_timeout AS "authTimeout",
      auth_expires_at AS "authExpiresAt",
      status,
      last_authorized_at AS "lastAuthorizedAt",
      last_sync_at AS "lastSyncAt",
      error_message AS "errorMessage"
    FROM telegram_user_sessions
    WHERE messenger_account_id = ${accountId}
      AND organization_id = ${organizationId}
      AND branch_id = ${branchId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function updateAccountStatus(accountId: string, status: MessengerAccountStatus, errorMessage?: string | null) {
  await ensureTelegramUserSchema();
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  await prisma.$executeRaw`
    UPDATE messenger_accounts
    SET status = ${status},
        is_active = ${status !== "disconnected"},
        enabled = ${status !== "disconnected"},
        error_message = ${errorMessage ?? null},
        disconnected_at = CASE WHEN ${status} = 'disconnected' THEN now() ELSE disconnected_at END,
        updated_at = now()
    WHERE id = ${accountId}
      AND organization_id = ${organizationId}
      AND branch_id = ${branchId}
  `;
  await prisma.$executeRaw`
    UPDATE telegram_user_sessions
    SET status = ${status},
        error_message = ${errorMessage ?? null},
        updated_at = now()
    WHERE messenger_account_id = ${accountId}
      AND organization_id = ${organizationId}
      AND branch_id = ${branchId}
  `;
  if (status === "needs_auth" || status === "error" || status === "degraded") {
    await recordIntegrationAudit({
      channel: "telegram_user",
      action: "telegram_user_sync_failed",
      status: "error",
      metadata: { accountId, code: status === "needs_auth" ? "REAUTH_REQUIRED" : "SYNC_FAILED" },
    });
    const repeated = status === "needs_auth" || await hasConsecutiveIntegrationFailures({
      channel: "telegram_user",
      failureAction: "telegram_user_sync_failed",
      successAction: "telegram_user_sync_verified",
      count: 3,
    });
    if (repeated) await notifyIntegrationOwner({
      channel: "telegram_user",
      eventKey: status === "needs_auth" ? "reauthorization_required" : "repeated_sync_failure",
      entityId: accountId,
      message: status === "needs_auth" ? "Рабочий Telegram филиала требует повторной авторизации." : "Три последовательные синхронизации рабочего Telegram завершились ошибкой.",
      throttleMinutes: 180,
    });
  }
}

async function deactivateOtherTelegramAccounts(keepAccountId: string) {
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  await prisma.$executeRaw`
    UPDATE messenger_accounts
    SET is_active = false,
        enabled = false,
        status = 'disconnected',
        disconnected_at = now(),
        updated_at = now()
    WHERE branch_id = ${branchId}
      AND organization_id = ${organizationId}
      AND channel = 'telegram'
      AND mode = 'user_session'
      AND id <> ${keepAccountId}
      AND status <> 'disconnected'
  `;
  await prisma.$executeRaw`
    UPDATE telegram_user_sessions
    SET status = 'disconnected',
        qr_token_encrypted = NULL,
        qr_expires_at = NULL,
        updated_at = now()
    WHERE branch_id = ${branchId}
      AND organization_id = ${organizationId}
      AND messenger_account_id <> ${keepAccountId}
      AND status <> 'disconnected'
  `;
}

export async function startTelegramUserAuth(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  if (!phone || phone.length < 8) throw new Error("Укажите рабочий Telegram-номер в международном формате.");
  const { apiId, apiHash } = await resolveTelegramUserCredentials();
  await ensureTelegramUserSchema();
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  const attemptId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const client = await getClient("", { apiId, apiHash });
  try {
    const { Api, version } = await loadGramJs();
    logAuthAttempt({
      action: "send_code_start",
      attemptId,
      phone: maskPhone(phone),
      gramJsVersion: version ?? "unknown",
    });
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    );
    const sessionString = client.session?.save?.() ? String(client.session.save()) : "";
    const phoneCodeHash = String(objectField(result, "phoneCodeHash") ?? "");
    const codeDelivery = sentCodeDelivery(result);
    const authExpiresAt = codeDelivery.timeout ? new Date(Date.now() + codeDelivery.timeout * 1000) : null;
    logCodeDelivery("sendCode", phone, codeDelivery);
    await deactivateOtherTelegramAccounts(accountId);
    let rows = await prisma.$queryRaw<TelegramAccountRow[]>`
      SELECT
        id,
        organization_id AS "organizationId",
        channel,
        mode,
        display_name AS "displayName",
        phone,
        username,
        is_active AS "isActive",
        status,
        last_sync_at AS "lastSyncAt",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM messenger_accounts
      WHERE organization_id = ${organizationId} AND branch_id = ${branchId} AND channel = 'telegram' AND mode = 'user_session' AND phone = ${phone}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    rows = rows[0]
      ? await prisma.$queryRaw<TelegramAccountRow[]>`
          UPDATE messenger_accounts
          SET display_name = ${phone},
              is_active = true,
              enabled = true,
              status = 'waiting_code',
              error_message = NULL,
              updated_at = now()
          WHERE id = ${rows[0].id}
            AND branch_id = ${branchId}
          RETURNING
            id,
            organization_id AS "organizationId",
            channel,
            mode,
            display_name AS "displayName",
            phone,
            username,
            is_active AS "isActive",
            status,
            last_sync_at AS "lastSyncAt",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `
      : await prisma.$queryRaw<TelegramAccountRow[]>`
          INSERT INTO messenger_accounts
            (id, branch_id, organization_id, channel, mode, display_name, phone, is_active, enabled, status, metadata_json, created_at, updated_at)
          VALUES
            (${accountId}, ${branchId}, ${organizationId}, 'telegram', 'user_session', ${phone}, ${phone}, true, true, 'waiting_code',
             ${JSON.stringify({ mode: "user_session", source: "telegram_user_auth" })}::jsonb, now(), now())
          RETURNING
            id,
            organization_id AS "organizationId",
            channel,
            mode,
            display_name AS "displayName",
            phone,
            username,
            is_active AS "isActive",
            status,
            last_sync_at AS "lastSyncAt",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `;
    if (!rows[0]) throw new Error("Не удалось сохранить Telegram account.");
    const actualAccountId = rows[0].id;
    await prisma.$executeRaw`
      DELETE FROM telegram_user_sessions
      WHERE branch_id = ${branchId}
        AND messenger_account_id IN (
        SELECT id
        FROM messenger_accounts
        WHERE organization_id = ${organizationId} AND branch_id = ${branchId} AND channel = 'telegram' AND mode = 'user_session' AND phone = ${phone} AND id <> ${actualAccountId}
      )
    `;
    await prisma.$executeRaw`
      UPDATE messenger_accounts
      SET is_active = false,
          status = 'disconnected',
          error_message = 'Duplicate Telegram account record archived',
          updated_at = now()
      WHERE channel = 'telegram' AND mode = 'user_session' AND phone = ${phone} AND id <> ${actualAccountId}
        AND organization_id = ${organizationId}
        AND branch_id = ${branchId}
    `;
    await prisma.$executeRaw`
      INSERT INTO telegram_user_sessions
        (id, branch_id, organization_id, messenger_account_id, phone, api_id_encrypted, api_hash_encrypted, session_encrypted, phone_code_hash_encrypted,
         auth_attempt_id, auth_dc_id, auth_delivery_type, auth_next_type, auth_timeout, auth_expires_at,
         status, created_at, updated_at)
      VALUES
        (${sessionId}, ${branchId}, ${organizationId}, ${actualAccountId}, ${phone}, ${encryptedJson(String(apiId))}::jsonb, ${encryptedJson(apiHash)}::jsonb,
         ${encryptedJson(sessionString)}::jsonb, ${encryptedJson(phoneCodeHash)}::jsonb,
         ${attemptId}, ${sessionDcId(client.session)}, ${codeDelivery.type}, ${codeDelivery.nextType}, ${codeDelivery.timeout}, ${authExpiresAt},
         'waiting_code', now(), now())
      ON CONFLICT (branch_id, messenger_account_id)
      DO UPDATE SET
        phone = EXCLUDED.phone,
        api_id_encrypted = EXCLUDED.api_id_encrypted,
        api_hash_encrypted = EXCLUDED.api_hash_encrypted,
        session_encrypted = EXCLUDED.session_encrypted,
        phone_code_hash_encrypted = EXCLUDED.phone_code_hash_encrypted,
        auth_attempt_id = EXCLUDED.auth_attempt_id,
        auth_dc_id = EXCLUDED.auth_dc_id,
        auth_delivery_type = EXCLUDED.auth_delivery_type,
        auth_next_type = EXCLUDED.auth_next_type,
        auth_timeout = EXCLUDED.auth_timeout,
        auth_expires_at = EXCLUDED.auth_expires_at,
        status = 'waiting_code',
        error_message = NULL,
        updated_at = now()
    `;
    logAuthState("waiting_code_saved", phone, actualAccountId);
    return { ok: true as const, account: toPublicAccount(rows[0]), codeDelivery };
  } catch (error) {
    throw new Error(safeError(error, "Не удалось отправить код Telegram"));
  } finally {
    safeDisconnectTelegramClient(client);
  }
}

export async function resendTelegramUserCode(accountId: string) {
  const branchId = getScopedBranchId();
  const session = await getSessionByAccount(accountId);
  if (!session) throw new Error("Telegram session не найдена. Запросите код заново.");
  const sessionString = decryptSecret(session.sessionEncrypted) ?? "";
  const phoneCodeHash = decryptSecret(session.phoneCodeHashEncrypted);
  if (!phoneCodeHash) throw new Error("Кодовая сессия Telegram потеряна. Запросите код заново.");
  const client = await getClient(sessionString);
  try {
    const { Api } = await loadGramJs();
    const result = await client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: session.phone,
        phoneCodeHash,
      })
    );
    const nextSessionString = client.session?.save?.() ? String(client.session.save()) : sessionString;
    const nextPhoneCodeHash = String(objectField(result, "phoneCodeHash") ?? phoneCodeHash);
    const codeDelivery = sentCodeDelivery(result);
    logCodeDelivery("resendCode", session.phone, codeDelivery);
    await prisma.$executeRaw`
      UPDATE telegram_user_sessions
      SET session_encrypted = ${encryptedJson(nextSessionString)}::jsonb,
          phone_code_hash_encrypted = ${encryptedJson(nextPhoneCodeHash)}::jsonb,
          status = 'waiting_code',
          error_message = NULL,
          updated_at = now()
      WHERE messenger_account_id = ${accountId}
        AND branch_id = ${branchId}
    `;
    await prisma.$executeRaw`
      UPDATE messenger_accounts
      SET status = 'waiting_code',
          is_active = true,
          error_message = NULL,
          updated_at = now()
      WHERE id = ${accountId}
        AND branch_id = ${branchId}
    `;
    return { ok: true as const, accountId, codeDelivery };
  } catch (error) {
    throw new Error(safeError(error, "Не удалось повторно запросить код Telegram"));
  } finally {
    safeDisconnectTelegramClient(client);
  }
}

export async function startTelegramUserQrAuth(phoneInput = "") {
  assertIntegrationEncryptionConfigured();
  const phone = phoneInput.trim() ? normalizePhone(phoneInput) : null;
  const { apiId, apiHash } = await resolveTelegramUserCredentials();
  await ensureTelegramUserSchema();
  cleanupQrRuntimeAttempts();
  const attemptId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const client = await getClient("", { apiId, apiHash }, { autoReconnect: true });
  try {
    const { Api, version } = await loadGramJs();
    logAuthAttempt({
      action: "qr_start",
      attemptId,
      phone: phone ? maskPhone(phone) : null,
      gramJsVersion: version ?? "unknown",
    });
    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId,
        apiHash,
        exceptIds: [],
      })
    );
    const { className, token, expiresAt } = loginTokenPayload(result);
    if (className.includes("LoginTokenSuccess")) {
      const sessionString = client.session?.save?.() ? String(client.session.save()) : "";
      const account = await createQrAccountAndSaveAuthorizedSession(accountId, sessionId, phone, sessionString, authorizationUser(result));
      safeDisconnectTelegramClient(client);
      return { ok: true as const, connected: true, account };
    }
    if (!className.includes("LoginToken")) throw new Error(`Telegram QR вернул неожиданный ответ: ${className || "unknown"}.`);
    const sessionString = client.session?.save?.() ? String(client.session.save()) : "";
    const login = loginTokenUrl(token);
    await createOrUpdateQrSession({
      accountId,
      sessionId,
      phone,
      sessionString,
      tokenBase64: login.tokenBase64,
      expiresAt,
      attemptId,
    });
    const qrDataUrl = await qrImageDataUrl(login.url);
    const runtimeAttempt: TelegramQrRuntimeAttempt = {
      accountId,
      sessionId,
      ...currentQrScope(),
      phone,
      client,
      apiId,
      apiHash,
      attemptId,
      expiresAt,
      tokenBase64: login.tokenBase64,
      loginUrl: login.url,
      qrImageDataUrl: qrDataUrl,
      status: "pending",
    };
    attachQrRuntimeHandler(runtimeAttempt);
    qrRuntimeAttempts.set(accountId, runtimeAttempt);
    return {
      ok: true as const,
      connected: false,
      accountId,
      qrLoginUrl: login.url,
      qrImageDataUrl: qrDataUrl,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    safeDisconnectTelegramClient(client);
    throw new Error(safeError(error, "Не удалось создать QR Telegram"));
  }
}

type QrSessionInput = {
  accountId: string;
  sessionId: string;
  phone: string | null;
  sessionString: string;
  tokenBase64: string;
  expiresAt: Date;
  attemptId: string;
};

async function createOrUpdateQrSession(input: QrSessionInput) {
  const display = input.phone ?? "Telegram QR";
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  const { apiId, apiHash } = await resolveTelegramUserCredentials();
  await deactivateOtherTelegramAccounts(input.accountId);
  await prisma.$executeRaw`
    INSERT INTO messenger_accounts
      (id, branch_id, organization_id, channel, mode, display_name, phone, is_active, enabled, status, metadata_json, created_at, updated_at)
    VALUES
      (${input.accountId}, ${branchId}, ${organizationId}, 'telegram', 'user_session', ${display}, ${input.phone}, true, true, 'waiting_qr',
       ${JSON.stringify({ mode: "user_session", auth: "qr" })}::jsonb, now(), now())
    ON CONFLICT (id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      display_name = EXCLUDED.display_name,
      phone = EXCLUDED.phone,
      is_active = true,
      enabled = true,
      status = 'waiting_qr',
      error_message = NULL,
      updated_at = now()
  `;
  await prisma.$executeRaw`
    INSERT INTO telegram_user_sessions
      (id, branch_id, organization_id, messenger_account_id, phone, api_id_encrypted, api_hash_encrypted, session_encrypted, qr_token_encrypted, qr_expires_at,
       auth_attempt_id, auth_dc_id, status, created_at, updated_at)
    VALUES
      (${input.sessionId}, ${branchId}, ${organizationId}, ${input.accountId}, ${input.phone ?? "qr"}, ${encryptedJson(String(apiId))}::jsonb,
       ${encryptedJson(apiHash)}::jsonb, ${encryptedJson(input.sessionString)}::jsonb,
       ${encryptedJson(input.tokenBase64)}::jsonb, ${input.expiresAt}, ${input.attemptId}, NULL, 'waiting_qr', now(), now())
    ON CONFLICT (branch_id, messenger_account_id)
    DO UPDATE SET
      phone = EXCLUDED.phone,
      api_id_encrypted = EXCLUDED.api_id_encrypted,
      api_hash_encrypted = EXCLUDED.api_hash_encrypted,
      session_encrypted = EXCLUDED.session_encrypted,
      qr_token_encrypted = EXCLUDED.qr_token_encrypted,
      qr_expires_at = EXCLUDED.qr_expires_at,
      auth_attempt_id = EXCLUDED.auth_attempt_id,
      status = 'waiting_qr',
      error_message = NULL,
      updated_at = now()
  `;
}

async function createQrAccountAndSaveAuthorizedSession(accountId: string, sessionId: string, phone: string | null, sessionString: string, user: unknown) {
  await createOrUpdateQrSession({
    accountId,
    sessionId,
    phone,
    sessionString,
    tokenBase64: "connected",
    expiresAt: new Date(),
    attemptId: crypto.randomUUID(),
  });
  return saveAuthorizedTelegramSession(accountId, sessionString, phone ?? "qr", user);
}

function cleanupQrRuntimeAttempts() {
  const now = Date.now();
  for (const [accountId, attempt] of qrRuntimeAttempts.entries()) {
    const expired = attempt.expiresAt.getTime() + 60_000 < now;
    const done = attempt.status === "connected" || attempt.status === "waiting_password" || attempt.status === "error";
    if (!expired && !done) continue;
    qrRuntimeAttempts.delete(accountId);
    safeDisconnectTelegramClient(attempt.client);
  }
}

function attachQrRuntimeHandler(attempt: TelegramQrRuntimeAttempt) {
  if (typeof attempt.client.addEventHandler !== "function") {
    attempt.status = "error";
    attempt.error = "MTProto client не поддерживает ожидание QR update.";
    return;
  }
  attempt.client.addEventHandler((update: unknown) => {
    if (!containsTelegramLoginTokenUpdate(update)) return;
    attempt.finalizing = finalizeQrRuntimeAttempt(attempt).catch((error) => {
      attempt.status = "error";
      attempt.error = safeError(error, "QR Telegram не подтверждён");
    });
  });
}

function containsTelegramLoginTokenUpdate(update: unknown): boolean {
  if (!update || typeof update !== "object") return false;
  if (telegramClassName(update).includes("UpdateLoginToken")) return true;
  const nestedUpdate = objectField(update, "update");
  if (nestedUpdate && containsTelegramLoginTokenUpdate(nestedUpdate)) return true;
  const updates = objectField(update, "updates");
  return Array.isArray(updates) && updates.some((item) => containsTelegramLoginTokenUpdate(item));
}

async function resolveQrLoginTokenResult(attempt: TelegramQrRuntimeAttempt, result: unknown, Api: GramJsModule["Api"]) {
  let nextResult = result;
  let className = telegramClassName(nextResult);
  if (className.includes("LoginTokenMigrateTo")) {
    const dcId = objectField(nextResult, "dcId");
    const token = objectField(nextResult, "token");
    const switcher = attempt.client as TelegramRuntimeClient & { _switchDC?: (dcId: number) => Promise<void> };
    if (typeof switcher._switchDC === "function" && typeof dcId === "number") await switcher._switchDC(dcId);
    nextResult = await attempt.client.invoke(new Api.auth.ImportLoginToken({ token }));
    className = telegramClassName(nextResult);
  }
  return { result: nextResult, className };
}

async function finalizeQrRuntimeAttempt(attempt: TelegramQrRuntimeAttempt) {
  if (attempt.status !== "pending") return;
  const { Api } = await loadGramJs();
  try {
    let result = await attempt.client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: attempt.apiId,
        apiHash: attempt.apiHash,
        exceptIds: [],
      })
    );
    const resolved = await resolveQrLoginTokenResult(attempt, result, Api);
    result = resolved.result;
    const className = resolved.className;
    if (!className.includes("LoginTokenSuccess")) {
      throw new Error(`Telegram QR вернул неожиданный ответ после сканирования: ${className || "unknown"}.`);
    }
    const nextSession = attempt.client.session?.save?.() ? String(attempt.client.session.save()) : "";
    const account = await saveAuthorizedTelegramSession(attempt.accountId, nextSession, attempt.phone ?? "qr", authorizationUser(result));
    attempt.account = account;
    attempt.status = "connected";
    safeDisconnectTelegramClient(attempt.client);
  } catch (error) {
    if (isPasswordNeeded(error)) {
      const branchId = getScopedBranchId();
      const nextSession = attempt.client.session?.save?.() ? String(attempt.client.session.save()) : "";
      await prisma.$executeRaw`
        UPDATE telegram_user_sessions
        SET session_encrypted = ${encryptedJson(nextSession)}::jsonb,
            status = 'waiting_password',
            error_message = NULL,
            updated_at = now()
        WHERE messenger_account_id = ${attempt.accountId}
          AND branch_id = ${branchId}
      `;
      await updateAccountStatus(attempt.accountId, "waiting_password", null);
      attempt.status = "waiting_password";
      safeDisconnectTelegramClient(attempt.client);
      return;
    }
    attempt.status = "error";
    attempt.error = safeError(error, "QR Telegram не подтверждён");
    await updateAccountStatus(attempt.accountId, "error", attempt.error);
    safeDisconnectTelegramClient(attempt.client);
  }
}

async function saveIfQrClientAuthorized(attempt: TelegramQrRuntimeAttempt) {
  try {
    let user: unknown = null;
    if (typeof attempt.client.getMe === "function") {
      user = await attempt.client.getMe().catch(() => null);
    }
    if (!user && typeof attempt.client.isUserAuthorized === "function") {
      const isAuthorized = await attempt.client.isUserAuthorized().catch(() => false);
      if (isAuthorized && typeof attempt.client.getMe === "function") user = await attempt.client.getMe().catch(() => null);
    }
    if (!user) return false;
    const nextSession = attempt.client.session?.save?.() ? String(attempt.client.session.save()) : "";
    attempt.account = await saveAuthorizedTelegramSession(attempt.accountId, nextSession, attempt.phone ?? "qr", user);
    attempt.status = "connected";
    safeDisconnectTelegramClient(attempt.client);
    return true;
  } catch {
    return false;
  }
}

async function refreshQrRuntimeAttempt(attempt: TelegramQrRuntimeAttempt) {
  const { Api } = await loadGramJs();
  let result = await attempt.client.invoke(
    new Api.auth.ExportLoginToken({
      apiId: attempt.apiId,
      apiHash: attempt.apiHash,
      exceptIds: [],
    })
  );
  const resolved = await resolveQrLoginTokenResult(attempt, result, Api);
  result = resolved.result;
  const { className, token, expiresAt } = loginTokenPayload(result);
  if (className.includes("LoginTokenSuccess")) {
    const nextSession = attempt.client.session?.save?.() ? String(attempt.client.session.save()) : "";
    attempt.account = await saveAuthorizedTelegramSession(attempt.accountId, nextSession, attempt.phone ?? "qr", authorizationUser(result));
    attempt.status = "connected";
    safeDisconnectTelegramClient(attempt.client);
    return;
  }
  if (!className.includes("LoginToken")) throw new Error(`Telegram QR вернул неожиданный ответ: ${className || "unknown"}.`);
  const login = loginTokenUrl(token);
  const nextSession = attempt.client.session?.save?.() ? String(attempt.client.session.save()) : "";
  await createOrUpdateQrSession({
    accountId: attempt.accountId,
    sessionId: attempt.sessionId,
    phone: attempt.phone,
    sessionString: nextSession,
    tokenBase64: login.tokenBase64,
    expiresAt,
    attemptId: attempt.attemptId,
  });
  attempt.tokenBase64 = login.tokenBase64;
  attempt.loginUrl = login.url;
  attempt.qrImageDataUrl = await qrImageDataUrl(login.url);
  attempt.expiresAt = expiresAt;
}

export async function checkTelegramUserQrAuth(accountId: string) {
  cleanupQrRuntimeAttempts();
  const runtimeAttempt = qrRuntimeAttempts.get(accountId);
  if (runtimeAttempt) {
    const scope = currentQrScope();
    if (runtimeAttempt.branchId !== scope.branchId || runtimeAttempt.userId !== scope.userId) {
      throw new Error("QR session принадлежит другому филиалу или пользователю");
    }
    if (runtimeAttempt.finalizing) await runtimeAttempt.finalizing;
    if (runtimeAttempt.status === "pending") await saveIfQrClientAuthorized(runtimeAttempt);
    if (runtimeAttempt.status === "connected" && runtimeAttempt.account) {
      qrRuntimeAttempts.delete(accountId);
      return { ok: true as const, connected: true, account: runtimeAttempt.account };
    }
    if (runtimeAttempt.status === "waiting_password") {
      qrRuntimeAttempts.delete(accountId);
      return { ok: true as const, connected: false, needsPassword: true, accountId };
    }
    if (runtimeAttempt.status === "error") throw new Error(runtimeAttempt.error ?? "QR Telegram не подтверждён");
    if (runtimeAttempt.expiresAt.getTime() < Date.now() + 4000) await refreshQrRuntimeAttempt(runtimeAttempt);
    return {
      ok: true as const,
      connected: false,
      accountId,
      qrLoginUrl: runtimeAttempt.loginUrl,
      qrImageDataUrl: runtimeAttempt.qrImageDataUrl,
      expiresAt: runtimeAttempt.expiresAt.toISOString(),
    };
  }
  const session = await getSessionByAccount(accountId);
  if (!session) throw new Error("QR session не найдена. Создайте QR заново.");
  const sessionString = decryptSecret(session.sessionEncrypted) ?? "";
  const storedApiId = Number(decryptSecret(session.apiIdEncrypted));
  const storedApiHash = decryptSecret(session.apiHashEncrypted);
  const currentCredentials = Number.isInteger(storedApiId) && storedApiId > 0 && storedApiHash
    ? { apiId: storedApiId, apiHash: storedApiHash }
    : await resolveTelegramUserCredentials();
  const { apiId, apiHash } = currentCredentials;
  if (!sessionString) throw new Error("QR session потеряна. Создайте QR заново.");
  const client = await getClient(sessionString, currentCredentials, { autoReconnect: true });
  const adoptedAttempt: TelegramQrRuntimeAttempt = {
    accountId,
    sessionId: session.id,
    ...currentQrScope(),
    phone: session.phone === "qr" ? null : session.phone,
    client,
    apiId,
    apiHash,
    attemptId: session.authAttemptId ?? crypto.randomUUID(),
    expiresAt: session.qrExpiresAt ?? new Date(Date.now() + 25_000),
    tokenBase64: decryptSecret(session.qrTokenEncrypted) ?? "",
    loginUrl: "",
    qrImageDataUrl: "",
    status: "pending",
  };
  try {
    if (await saveIfQrClientAuthorized(adoptedAttempt)) {
      qrRuntimeAttempts.delete(accountId);
      return { ok: true as const, connected: true, account: adoptedAttempt.account };
    }
    const { Api } = await loadGramJs();
    const result = await client.invoke(new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }));
    const className = telegramClassName(result);
    if (className.includes("LoginTokenMigrateTo")) {
      const dcId = objectField(result, "dcId");
      const token = objectField(result, "token");
      const switcher = client as TelegramRuntimeClient & { _switchDC?: (dcId: number) => Promise<void> };
      if (typeof switcher._switchDC === "function" && typeof dcId === "number") await switcher._switchDC(dcId);
      const migratedResult = await client.invoke(new Api.auth.ImportLoginToken({ token }));
      if (telegramClassName(migratedResult).includes("LoginTokenSuccess")) {
        const nextSession = client.session?.save?.() ? String(client.session.save()) : sessionString;
        const account = await saveAuthorizedTelegramSession(accountId, nextSession, session.phone, authorizationUser(migratedResult));
        safeDisconnectTelegramClient(client);
        return { ok: true as const, connected: true, account };
      }
      throw new Error(`Telegram QR вернул неожиданный ответ после миграции: ${telegramClassName(migratedResult) || "unknown"}.`);
    }
    if (className.includes("LoginTokenSuccess")) {
      const nextSession = client.session?.save?.() ? String(client.session.save()) : sessionString;
      const account = await saveAuthorizedTelegramSession(accountId, nextSession, session.phone, authorizationUser(result));
      safeDisconnectTelegramClient(client);
      return { ok: true as const, connected: true, account };
    }
    if (className.includes("LoginToken")) {
      const { token, expiresAt } = loginTokenPayload(result);
      const login = loginTokenUrl(token);
      const nextSession = client.session?.save?.() ? String(client.session.save()) : sessionString;
      const phone = session.phone === "qr" ? null : session.phone;
      await createOrUpdateQrSession({
        accountId,
        sessionId: session.id,
        phone,
        sessionString: nextSession,
        tokenBase64: login.tokenBase64,
        expiresAt,
        attemptId: session.authAttemptId ?? crypto.randomUUID(),
      });
      const qrDataUrl = await qrImageDataUrl(login.url);
      const attempt: TelegramQrRuntimeAttempt = {
        accountId,
        sessionId: session.id,
        ...currentQrScope(),
        phone,
        client,
        apiId,
        apiHash,
        attemptId: session.authAttemptId ?? crypto.randomUUID(),
        expiresAt,
        tokenBase64: login.tokenBase64,
        loginUrl: login.url,
        qrImageDataUrl: qrDataUrl,
        status: "pending",
      };
      attachQrRuntimeHandler(attempt);
      qrRuntimeAttempts.set(accountId, attempt);
      return {
        ok: true as const,
        connected: false,
        accountId,
        qrLoginUrl: login.url,
        qrImageDataUrl: qrDataUrl,
        expiresAt: expiresAt.toISOString(),
      };
    }
    throw new Error(`Telegram QR вернул неожиданный ответ: ${className || "unknown"}.`);
  } catch (error) {
    const message = safeError(error, "QR Telegram не подтверждён");
    if (isPasswordNeeded(error)) {
      const branchId = getScopedBranchId();
      const nextSession = client.session?.save?.() ? String(client.session.save()) : sessionString;
      await prisma.$executeRaw`
        UPDATE telegram_user_sessions
        SET session_encrypted = ${encryptedJson(nextSession)}::jsonb,
            status = 'waiting_password',
            error_message = NULL,
            updated_at = now()
        WHERE messenger_account_id = ${accountId}
          AND branch_id = ${branchId}
      `;
      await updateAccountStatus(accountId, "waiting_password", null);
      safeDisconnectTelegramClient(client);
      return { ok: true as const, connected: false, needsPassword: true, accountId };
    }
    await updateAccountStatus(accountId, "error", message);
    safeDisconnectTelegramClient(client);
    throw new Error(message);
  }
}

function isPasswordNeeded(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /SESSION_PASSWORD_NEEDED|PASSWORD/i.test(message);
}

function userField(user: unknown, key: "firstName" | "lastName" | "username" | "phone") {
  if (!user || typeof user !== "object") return null;
  const value = (user as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function sessionDcId(session: unknown) {
  const value = objectField(session, "dcId") ?? objectField(session, "_dcId") ?? objectField(session, "dc");
  return value === undefined || value === null ? null : String(value);
}

function telegramClassName(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = record.className;
  if (typeof direct === "string") return direct;
  const constructorName = (value as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof constructorName === "string" ? constructorName : "";
}

function booleanField(value: unknown, key: string) {
  const raw = objectField(value, key);
  return typeof raw === "boolean" ? raw : false;
}

function numericField(value: unknown, key: string) {
  const raw = objectField(value, key);
  return typeof raw === "number" ? raw : null;
}

function isMainInboxDialog(dialog: TelegramDialog) {
  const folderId = dialog.folderId ?? dialog.dialog?.folderId ?? numericField(dialog, "folderId");
  return !dialog.archived && !dialog.isArchived && (folderId === null || folderId === undefined || folderId === 0);
}

function isConversationDialog(dialog: TelegramDialog) {
  if (!isMainInboxDialog(dialog)) return false;
  const entity = dialog.entity ?? {};
  const entityClass = telegramClassName(entity).toLowerCase();
  const dialogClass = telegramClassName(dialog).toLowerCase();
  const inputClass = telegramClassName(dialog.inputEntity).toLowerCase();
  const classText = `${entityClass} ${dialogClass} ${inputClass}`;
  const isUser = dialog.isUser || entityClass.includes("user") || inputClass.includes("user");
  const isChat = dialog.isGroup || entityClass === "chat" || entityClass.includes("chat") || inputClass.includes("chat");
  const isChannel = dialog.isChannel || entityClass.includes("channel") || inputClass.includes("channel");
  const isBroadcast = Boolean(entity.broadcast) || booleanField(entity, "broadcast") || classText.includes("broadcast");
  const isMegaGroup = Boolean(entity.megagroup || entity.gigagroup) || booleanField(entity, "megagroup") || booleanField(entity, "gigagroup");
  const isBot = Boolean(entity.bot) || booleanField(entity, "bot");
  if (isBot) return false;
  if (isUser) return true;
  if (isChat && !isBroadcast) return true;
  return isChannel && isMegaGroup && !isBroadcast;
}

function telegramExternalConversationId(accountId: string, chatId: string) {
  return `telegram:user:${accountId}:${chatId}`;
}

function telegramExternalMessageId(conversationId: string, messageId: string) {
  return `telegram:message:${conversationId}:${messageId}`;
}

function deliveryLabel(className: string) {
  const normalized = className.toLowerCase();
  if (normalized.includes("sentcodetypeapp")) return "Код отправлен в приложение Telegram на рабочем аккаунте.";
  if (normalized.includes("sentcodetypesms")) return "Код отправлен по SMS.";
  if (normalized.includes("sentcodetypecall")) return "Код будет продиктован в звонке.";
  if (normalized.includes("sentcodetypeflashcall")) return "Telegram ожидает flash-call подтверждение.";
  if (normalized.includes("sentcodetypemissedcall")) return "Telegram ожидает подтверждение пропущенным звонком.";
  if (normalized.includes("sentcodetypeemail")) return "Код отправлен на email, привязанный к Telegram.";
  if (normalized.includes("sentcodetypefragment")) return "Код отправлен через Fragment.";
  return "Telegram принял запрос на код авторизации.";
}

function sentCodeDelivery(result: unknown): TelegramCodeDelivery {
  const type = objectField(result, "type");
  const nextType = objectField(result, "nextType");
  const timeout = objectField(result, "timeout");
  const length = objectField(type, "length");
  const className = telegramClassName(type);
  return {
    type: className || "unknown",
    label: deliveryLabel(className),
    nextType: telegramClassName(nextType) || null,
    timeout: typeof timeout === "number" ? timeout : null,
    codeLength: typeof length === "number" ? length : null,
  };
}

function bytesToBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  return Buffer.alloc(0);
}

function loginTokenUrl(token: unknown) {
  const buffer = bytesToBuffer(token);
  if (!buffer.length) throw new Error("Telegram не вернул QR login token.");
  return {
    tokenBase64: buffer.toString("base64url"),
    url: `tg://login?token=${buffer.toString("base64url")}`,
  };
}

async function qrImageDataUrl(value: string) {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(value, {
    margin: 1,
    scale: 6,
    errorCorrectionLevel: "M",
  });
}

function loginTokenPayload(result: unknown) {
  const className = telegramClassName(result);
  const token = objectField(result, "token");
  const expires = objectField(result, "expires");
  const expiresAt = typeof expires === "number" ? new Date(expires * 1000) : new Date(Date.now() + 25_000);
  return { className, token, expiresAt };
}

function authUser(value: unknown) {
  return objectField(value, "user") ?? value;
}

function authorizationUser(value: unknown) {
  return authUser(objectField(value, "authorization") ?? value);
}

function userDisplayName(user: unknown, fallback: string) {
  const parts = [userField(user, "firstName"), userField(user, "lastName")].filter(Boolean);
  if (parts.length) return parts.join(" ");
  const username = userField(user, "username");
  if (username) return `@${username}`;
  return fallback;
}

async function saveAuthorizedTelegramSession(accountId: string, sessionString: string, fallbackPhone: string, user: unknown) {
  const phone = userField(user, "phone") ? `+${userField(user, "phone")?.replace(/^\+/, "")}` : fallbackPhone;
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  const { apiId, apiHash } = await resolveTelegramUserCredentials();
  const existingAccounts = phone
    ? await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM messenger_accounts
        WHERE organization_id = ${organizationId}
          AND branch_id = ${branchId}
          AND channel = 'telegram'
          AND mode = 'user_session'
          AND phone = ${phone}
        ORDER BY created_at DESC
        LIMIT 1
      `
    : [];
  const targetAccountId = existingAccounts[0]?.id ?? accountId;
  if (targetAccountId !== accountId) {
    await prisma.$executeRaw`
      DELETE FROM telegram_user_sessions
      WHERE messenger_account_id = ${targetAccountId}
        AND organization_id = ${organizationId}
        AND branch_id = ${branchId}
    `;
    await prisma.$executeRaw`
      DELETE FROM telegram_user_sessions
      WHERE messenger_account_id = ${accountId}
        AND organization_id = ${organizationId}
        AND branch_id = ${branchId}
    `;
    await prisma.$executeRaw`
      UPDATE messenger_accounts
      SET phone = NULL,
          is_active = false,
          enabled = false,
          status = 'disconnected',
          disconnected_at = now(),
          error_message = 'Superseded by existing Telegram account',
          updated_at = now()
      WHERE id = ${accountId}
        AND organization_id = ${organizationId}
        AND branch_id = ${branchId}
    `;
  }
  await prisma.$executeRaw`
    INSERT INTO telegram_user_sessions
      (id, branch_id, organization_id, messenger_account_id, phone, api_id_encrypted, api_hash_encrypted, session_encrypted,
       qr_token_encrypted, qr_expires_at, status, last_authorized_at, error_message, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${branchId}, ${organizationId}, ${targetAccountId}, ${phone}, ${encryptedJson(String(apiId))}::jsonb,
       ${encryptedJson(apiHash)}::jsonb, ${encryptedJson(sessionString)}::jsonb,
       NULL, NULL, 'connected', now(), NULL, now(), now())
    ON CONFLICT (branch_id, messenger_account_id)
    DO UPDATE SET
        phone = EXCLUDED.phone,
        api_id_encrypted = EXCLUDED.api_id_encrypted,
        api_hash_encrypted = EXCLUDED.api_hash_encrypted,
        session_encrypted = ${encryptedJson(sessionString)}::jsonb,
        qr_token_encrypted = NULL,
        qr_expires_at = NULL,
        status = 'connected',
        last_authorized_at = now(),
        error_message = NULL,
        updated_at = now()
  `;
  const accountRows = await prisma.$queryRaw<TelegramAccountRow[]>`
    UPDATE messenger_accounts
    SET display_name = ${userDisplayName(user, phone)},
        phone = ${phone},
        username = ${userField(user, "username")},
        status = 'connected',
        is_active = true,
        enabled = true,
        connected_at = COALESCE(connected_at, now()),
        disconnected_at = NULL,
        error_message = NULL,
        metadata_json = jsonb_build_object('mode', 'user_session', 'source', 'telegram_user_session'),
        updated_at = now()
    WHERE id = ${targetAccountId}
      AND organization_id = ${organizationId}
      AND branch_id = ${branchId}
    RETURNING
      id, organization_id AS "organizationId", channel, mode, display_name AS "displayName", phone, username, is_active AS "isActive", status,
      last_sync_at AS "lastSyncAt", error_message AS "errorMessage", created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  await prisma.$executeRaw`
    UPDATE messenger_accounts
    SET is_active = false,
        enabled = false,
        disconnected_at = now(),
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND branch_id = ${branchId}
      AND channel = 'telegram'
      AND mode = 'user_session'
      AND id <> ${targetAccountId}
  `;
  if (!accountRows[0]) throw new Error("Не удалось сохранить Telegram account.");
  const account = toPublicAccount(accountRows[0]);
  await recordIntegrationAudit({ channel: "telegram_user", action: "telegram_user_connected", metadata: { accountId: account.id, mode: "user_session" } });
  await notifyIntegrationOwner({ channel: "telegram_user", eventKey: "account_connected", entityId: account.id, message: "Рабочий Telegram филиала подключён по QR.", throttleMinutes: 5 });
  void syncTelegramUserAccount(account.id, 30).catch((error) => {
    console.warn("[messenger.telegram_user.sync]", {
      action: "post_auth_sync_failed",
      accountId: account.id,
      error: safeError(error, "Telegram post-auth sync failed"),
    });
  });
  return account;
}

export async function confirmTelegramUserCode(accountId: string, codeInput: string) {
  const branchId = getScopedBranchId();
  const code = codeInput.trim().replace(/\s+/g, "");
  if (!code) throw new Error("Введите код Telegram.");
  const session = await getSessionByAccount(accountId);
  if (!session) throw new Error("Telegram session не найдена. Запросите код заново.");
  const sessionString = decryptSecret(session.sessionEncrypted) ?? "";
  const phoneCodeHash = decryptSecret(session.phoneCodeHashEncrypted);
  if (!phoneCodeHash) throw new Error("Кодовая сессия Telegram потеряна. Запросите код заново.");
  const client = await getClient(sessionString);
  try {
    const { Api } = await loadGramJs();
    const user = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: session.phone,
        phoneCodeHash,
        phoneCode: code,
      })
    );
    const nextSession = client.session?.save?.() ? String(client.session.save()) : sessionString;
    const account = await saveAuthorizedTelegramSession(accountId, nextSession, session.phone, authUser(user));
    return { ok: true as const, needsPassword: false, account };
  } catch (error) {
    const nextSession = client.session?.save?.() ? String(client.session.save()) : sessionString;
    await prisma.$executeRaw`
      UPDATE telegram_user_sessions
      SET session_encrypted = ${encryptedJson(nextSession)}::jsonb,
          status = ${isPasswordNeeded(error) ? "waiting_password" : "error"},
          error_message = ${isPasswordNeeded(error) ? null : safeError(error, "Код Telegram не принят")},
          updated_at = now()
      WHERE messenger_account_id = ${accountId}
        AND branch_id = ${branchId}
    `;
    await updateAccountStatus(accountId, isPasswordNeeded(error) ? "waiting_password" : "error", isPasswordNeeded(error) ? null : safeError(error));
    if (isPasswordNeeded(error)) return { ok: true as const, needsPassword: true, accountId };
    throw new Error(safeError(error, "Код Telegram не принят"));
  } finally {
    safeDisconnectTelegramClient(client);
  }
}

export async function confirmTelegramUserPassword(accountId: string, password: string) {
  if (!password) throw new Error("Введите пароль 2FA Telegram.");
  const session = await getSessionByAccount(accountId);
  if (!session) throw new Error("Telegram session не найдена. Запросите код заново.");
  const sessionString = decryptSecret(session.sessionEncrypted) ?? "";
  const client = await getClient(sessionString);
  try {
    const { Api, Password } = await loadGramJs();
    const passwordInfo = await client.invoke(new Api.account.GetPassword());
    const passwordCheck = await Password.computeCheck(passwordInfo, password);
    const authorization = await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
    const user = authUser(authorization);
    const nextSession = client.session?.save?.() ? String(client.session.save()) : sessionString;
    const account = await saveAuthorizedTelegramSession(accountId, nextSession, session.phone, user);
    return { ok: true as const, account };
  } catch (error) {
    await updateAccountStatus(accountId, "error", safeError(error, "Пароль 2FA Telegram не принят"));
    throw new Error(safeError(error, "Пароль 2FA Telegram не принят"));
  } finally {
    safeDisconnectTelegramClient(client);
  }
}

function peerId(value: TelegramDialog | TelegramMessage | unknown) {
  const dialog = value as TelegramDialog;
  const raw = dialog?.id ?? dialog?.inputEntity ?? dialog?.entity?.id ?? dialog?.dialog?.peer ?? (value as TelegramMessage)?.peerId ?? (value as TelegramMessage)?.senderId;
  if (raw && typeof raw === "object") {
    const peer = raw as TelegramPeer;
    const nestedId = peer.userId ?? peer.channelId ?? peer.chatId ?? peer.id;
    if (nestedId !== undefined && nestedId !== null) return String(nestedId);
    if (typeof (raw as { toString?: unknown }).toString === "function") {
      const text = String((raw as { toString(): string }).toString());
      return text === "[object Object]" ? "" : text;
    }
    return "";
  }
  return raw === undefined || raw === null ? "" : String(raw);
}

function telegramPeerKind(input: {
  inputEntity?: unknown;
  entity?: unknown;
  peer?: unknown;
  isUser?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
}): TelegramPeerSnapshot["type"] {
  const classText = [input.inputEntity, input.entity, input.peer].map((item) => telegramClassName(item).toLowerCase()).join(" ");
  if (input.isChannel || classText.includes("channel")) return "channel";
  if (input.isGroup || classText.includes("chat")) return "chat";
  if (input.isUser || classText.includes("user")) return "user";
  return null;
}

function telegramPeerIdFromParts(input: { inputEntity?: unknown; entity?: unknown; peer?: unknown; fallback?: string | null }) {
  return (
    stringValue(objectField(input.inputEntity, "userId")) ??
    stringValue(objectField(input.inputEntity, "channelId")) ??
    stringValue(objectField(input.inputEntity, "chatId")) ??
    stringValue(objectField(input.inputEntity, "id")) ??
    stringValue(objectField(input.entity, "id")) ??
    stringValue(objectField(input.peer, "userId")) ??
    stringValue(objectField(input.peer, "channelId")) ??
    stringValue(objectField(input.peer, "chatId")) ??
    stringValue(objectField(input.peer, "id")) ??
    input.fallback ??
    null
  );
}

function telegramAccessHashFromParts(input: { inputEntity?: unknown; entity?: unknown; peer?: unknown }) {
  return (
    stringValue(objectField(input.inputEntity, "accessHash")) ??
    stringValue(objectField(input.entity, "accessHash")) ??
    stringValue(objectField(input.peer, "accessHash"))
  );
}

function telegramPeerSnapshotFromDialog(dialog: TelegramDialog): TelegramPeerSnapshot {
  const inputEntity = dialog.inputEntity;
  const entity = dialog.entity;
  const peer = dialog.dialog?.peer;
  const chatId = peerId(dialog);
  return {
    id: telegramPeerIdFromParts({ inputEntity, entity, peer, fallback: chatId }),
    chatId: chatId || null,
    accessHash: telegramAccessHashFromParts({ inputEntity, entity, peer }),
    type: telegramPeerKind({ inputEntity, entity, peer, isUser: dialog.isUser, isGroup: dialog.isGroup, isChannel: dialog.isChannel }),
    username: stringValue(objectField(entity, "username")) ?? null,
    phone: stringValue(objectField(entity, "phone")) ?? null,
    className: telegramClassName(entity) || null,
    inputClassName: telegramClassName(inputEntity) || null,
  };
}

function telegramPeerSnapshotFromUser(user: unknown): TelegramPeerSnapshot {
  const id = telegramUserId(user);
  return {
    id,
    chatId: id,
    accessHash: telegramAccessHashFromParts({ entity: user }),
    type: "user",
    username: stringValue(objectField(user, "username")),
    phone: stringValue(objectField(user, "phone")),
    className: telegramClassName(user) || null,
    inputClassName: null,
  };
}

function messageDate(value?: number | Date) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value * 1000);
  return new Date();
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value && typeof value === "object") {
    const primitiveValue = objectField(value, "value");
    if (primitiveValue !== undefined && primitiveValue !== value) {
      const nested: string | null = stringValue(primitiveValue);
      if (nested) return nested;
    }
    const toString = (value as { toString?: unknown }).toString;
    if (typeof toString === "function" && toString !== Object.prototype.toString) {
      const text = String(toString.call(value)).trim();
      if (text && text !== "[object Object]") return text;
    }
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function telegramAttributeValue(attributes: unknown, key: string) {
  if (!Array.isArray(attributes)) return undefined;
  for (const attribute of attributes) {
    const value = objectField(attribute, key);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function telegramDocumentFileName(document: unknown) {
  const attributes = objectField(document, "attributes");
  const fileName = telegramAttributeValue(attributes, "fileName");
  return stringValue(fileName);
}

function telegramMediaDcId(media: unknown, document: unknown, photo: unknown) {
  return numberValue(objectField(document, "dcId") ?? objectField(photo, "dcId") ?? objectField(media, "dcId"));
}

function telegramMediaAccessHash(source: unknown) {
  return stringValue(objectField(source, "accessHash"));
}

function telegramMediaReference(source: unknown) {
  const raw = objectField(source, "fileReference");
  if (Buffer.isBuffer(raw)) return raw.toString("base64url");
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString("base64url");
  return stringValue(raw);
}

function telegramFileExtension(mimeType: string | null | undefined, type: Attachment["type"]) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/ogg") return "ogg";
  if (type === "photo" || type === "image" || type === "sticker") return "jpg";
  if (type === "video") return "mp4";
  if (type === "animation") return "gif";
  return "bin";
}

function telegramAttributesText(attributes: unknown) {
  if (!Array.isArray(attributes)) return "";
  return attributes
    .map((attribute) =>
      [
        telegramClassName(attribute),
        booleanField(attribute, "voice") ? "voice" : "",
        booleanField(attribute, "roundMessage") ? "roundMessage" : "",
        booleanField(attribute, "animated") ? "animated" : "",
        booleanField(attribute, "sticker") ? "sticker" : "",
        stringValue(objectField(attribute, "fileName")) ?? "",
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ")
    .toLowerCase();
}

function telegramAttachmentType(media: unknown, document: unknown): Attachment["type"] {
  const attributes = objectField(document, "attributes");
  const attributeText = telegramAttributesText(attributes);
  const classText = `${telegramClassName(media)} ${telegramClassName(document)} ${attributeText} ${stringValue(objectField(document, "mimeType")) ?? ""}`.toLowerCase();
  const mimeType = stringValue(objectField(document, "mimeType"))?.toLowerCase() ?? "";
  if (classText.includes("voice")) return "voice";
  if (classText.includes("roundmessage")) return "video_note";
  if (classText.includes("sticker") || mimeType === "application/x-tgsticker") return "sticker";
  if (classText.includes("animation") || mimeType === "image/gif") return "animation";
  if (classText.includes("photo") || mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/") || classText.includes("video")) return "video";
  if (mimeType.startsWith("audio/") || classText.includes("audio")) return "audio";
  if (classText.includes("webpage")) return "link";
  if (classText.includes("contact")) return "contact";
  if (classText.includes("geo") || classText.includes("venue")) return "location";
  if (document) return "document";
  return "unsupported";
}

function normalizeTelegramAttachments(message: TelegramMessage, externalMessageId: string): Attachment[] {
  const media = message.media;
  if (!media) return [];
  const document = objectField(media, "document") ?? (telegramClassName(media).toLowerCase().includes("document") ? media : null);
  const photo = objectField(media, "photo") ?? (telegramClassName(media).toLowerCase().includes("photo") ? media : null);
  const webPage = objectField(media, "webpage") ?? objectField(media, "webPage");
  const source = document || photo || webPage || media;
  const type = telegramAttachmentType(media, document ?? photo ?? webPage);
  const mimeType = stringValue(objectField(document, "mimeType"));
  const sourceId = stringValue(objectField(source, "id"));
  const externalAttachmentId =
    sourceId ??
    stringValue(objectField(source, "url")) ??
    stringValue(objectField(message, "groupedId")) ??
    externalMessageId;
  const extension = telegramFileExtension(mimeType, type);
  const rawName =
    telegramDocumentFileName(document) ??
    stringValue(objectField(webPage, "title")) ??
    (type === "photo" || type === "image"
      ? `photo-${externalAttachmentId}.${extension}`
      : type === "video"
        ? `video-${externalAttachmentId}.${extension}`
        : type === "voice"
          ? `voice-${externalAttachmentId}.${extension}`
          : type === "link"
            ? "Ссылка"
            : `attachment-${externalAttachmentId}.${extension}`);
  const name = messengerAttachmentDisplayName({ type, name: rawName, mimeType, metadataJson: { source: "telegram_user_session" } });
  const size = numberValue(objectField(document, "size"));
  const width = numberValue(telegramAttributeValue(objectField(document, "attributes"), "w") ?? objectField(photo, "w"));
  const height = numberValue(telegramAttributeValue(objectField(document, "attributes"), "h") ?? objectField(photo, "h"));
  const duration = numberValue(telegramAttributeValue(objectField(document, "attributes"), "duration"));
  const metadata = {
    source: "telegram_user_session",
    status: type === "unsupported" ? "unsupported" : "queued",
    telegram: {
      messageId: stringValue(message.id),
      externalMessageId,
      groupedId: stringValue(message.groupedId),
      mediaClass: telegramClassName(media),
      attributeClass: telegramAttributesText(objectField(document, "attributes")),
      documentId: document ? sourceId : null,
      photoId: photo ? sourceId : null,
      accessHash: telegramMediaAccessHash(source),
      fileReference: telegramMediaReference(source),
      dcId: telegramMediaDcId(media, document, photo),
    },
  };
  return [
    {
      id: `tg-${externalMessageId}-${externalAttachmentId}`,
      type,
      url: "",
      previewUrl: "",
      name,
      size,
      mimeType: mimeType ?? undefined,
      status: type === "unsupported" ? "unsupported" : "queued",
      caption: stringValue(message.message ?? message.text) ?? undefined,
      width,
      height,
      duration,
      metadataJson: metadata,
    },
  ];
}

function messageText(message?: TelegramMessage) {
  const text = message?.message ?? message?.text ?? "";
  if (text.trim()) return text;
  return "";
}

function attachmentPreviewLabel(attachment: Attachment) {
  if (attachment.type === "photo" || attachment.type === "image") return "Фото";
  if (attachment.type === "video") return "Видео";
  if (attachment.type === "voice") return "Голосовое";
  if (attachment.type === "audio") return "Аудио";
  if (attachment.type === "sticker") return "Стикер";
  if (attachment.type === "animation") return "GIF";
  if (attachment.type === "video_note") return "Видеосообщение";
  if (attachment.type === "link") return "Ссылка";
  if (attachment.type === "contact") return "Контакт";
  if (attachment.type === "location") return "Геопозиция";
  if (attachment.type === "document") return "Документ";
  return "Вложение";
}

function messagePreviewText(message?: TelegramMessage) {
  if (!message) return "";
  const text = messageText(message);
  if (text) return text;
  const attachments = normalizeTelegramAttachments(message, stringValue(message.id) ?? "preview");
  if (!attachments.length) return "";
  return attachments.length === 1 ? attachmentPreviewLabel(attachments[0]) : `${attachmentPreviewLabel(attachments[0])} и ещё ${attachments.length - 1}`;
}

async function upsertAttachmentRows(input: {
  organizationId: string;
  messengerAccountId: string | null;
  conversationId: string;
  messageId: string;
  channel: "telegram";
  direction: "inbound" | "outbound" | "system";
  externalMessageId: string;
  externalPeerId: string | null;
  attachments: Attachment[];
}) {
  for (const attachment of input.attachments) {
    const metadata = attachment.metadataJson ?? { source: "telegram_user_session", status: attachment.status ?? "queued" };
    const telegram = typeof metadata.telegram === "object" && metadata.telegram ? (metadata.telegram as Record<string, unknown>) : {};
    const externalDocumentId = typeof telegram.documentId === "string" ? telegram.documentId : null;
    const externalFileId = typeof telegram.photoId === "string" ? telegram.photoId : externalDocumentId;
    const telegramDcId = typeof telegram.dcId === "number" ? telegram.dcId : null;
    await prisma.$executeRaw`
      INSERT INTO messenger_attachments
        (id, branch_id, organization_id, messenger_account_id, conversation_id, message_id, channel, direction, external_attachment_id,
         external_file_id, external_document_id, external_message_id, external_peer_id, telegram_dc_id,
         type, url, name, size, mime_type, preview_url, metadata_json, status, original_storage_key, thumbnail_storage_key,
         caption, width, height, duration, updated_at)
      VALUES
        (${attachment.id}, ${getScopedBranchId()}, ${input.organizationId}, ${input.messengerAccountId}, ${input.conversationId}, ${input.messageId}, ${input.channel}, ${input.direction}, ${attachment.id},
         ${externalFileId}, ${externalDocumentId}, ${input.externalMessageId}, ${input.externalPeerId}, ${telegramDcId},
         ${attachment.type},
         ${attachment.url ?? null}, ${attachment.name ?? null}, ${attachment.size ?? null}, ${attachment.mimeType ?? null}, ${attachment.previewUrl ?? null},
         ${JSON.stringify(metadata)}::jsonb,
         ${attachment.status ?? "queued"}, NULL, NULL, ${attachment.caption ?? null}, ${attachment.width ?? null}, ${attachment.height ?? null}, ${attachment.duration ?? null}, now())
      ON CONFLICT (id) DO UPDATE SET
        messenger_account_id = COALESCE(EXCLUDED.messenger_account_id, messenger_attachments.messenger_account_id),
        conversation_id = COALESCE(EXCLUDED.conversation_id, messenger_attachments.conversation_id),
        direction = COALESCE(EXCLUDED.direction, messenger_attachments.direction),
        external_message_id = COALESCE(EXCLUDED.external_message_id, messenger_attachments.external_message_id),
        external_peer_id = COALESCE(EXCLUDED.external_peer_id, messenger_attachments.external_peer_id),
        external_file_id = COALESCE(EXCLUDED.external_file_id, messenger_attachments.external_file_id),
        external_document_id = COALESCE(EXCLUDED.external_document_id, messenger_attachments.external_document_id),
        telegram_dc_id = COALESCE(EXCLUDED.telegram_dc_id, messenger_attachments.telegram_dc_id),
        type = EXCLUDED.type,
        name = COALESCE(EXCLUDED.name, messenger_attachments.name),
        size = COALESCE(EXCLUDED.size, messenger_attachments.size),
        mime_type = COALESCE(EXCLUDED.mime_type, messenger_attachments.mime_type),
        metadata_json = messenger_attachments.metadata_json || EXCLUDED.metadata_json,
        status = CASE WHEN messenger_attachments.status = 'ready' THEN messenger_attachments.status ELSE EXCLUDED.status END,
        updated_at = now()
    `;
    if (attachment.status !== "unsupported") {
      await enqueueMessengerMediaJob({
        organizationId: input.organizationId,
        messengerAccountId: input.messengerAccountId,
        attachmentId: attachment.id,
        operation: "download",
      });
    }
  }
}

async function refreshTelegramDialogAvatar(conversationId: string, entity: unknown, client?: TelegramRuntimeClient) {
  if (!client?.downloadProfilePhoto || !entity) return;
  const branchId = getScopedBranchId();
  const rows = await prisma.$queryRaw<Array<{ avatarUrl: string | null; avatarUpdatedAt: Date | null; avatarStatus: string | null }>>`
    SELECT participant_avatar_url AS "avatarUrl",
           avatar_updated_at AS "avatarUpdatedAt",
           avatar_status AS "avatarStatus"
    FROM messenger_conversations
    WHERE id = ${conversationId}
      AND branch_id = ${branchId}
    LIMIT 1
  `;
  const current = rows[0];
  if (current?.avatarUrl && current.avatarStatus === "available") return;
  if (current?.avatarUpdatedAt && Date.now() - current.avatarUpdatedAt.getTime() < 6 * 60 * 60 * 1000) return;
  try {
    const avatar = await client.downloadProfilePhoto(entity, { isBig: false });
    const buffer = Buffer.isBuffer(avatar) ? avatar : undefined;
    if (!buffer?.length) {
      await prisma.$executeRaw`
        UPDATE messenger_conversations
        SET avatar_status = 'unavailable',
            avatar_updated_at = now(),
            updated_at = now()
        WHERE id = ${conversationId}
          AND branch_id = ${branchId}
      `;
      return;
    }
    if (!messengerStorageStatus().configured) {
      await prisma.$executeRaw`
        UPDATE messenger_conversations
        SET avatar_status = 'failed',
            avatar_error = 'Messenger storage не настроен',
            avatar_updated_at = now(),
            updated_at = now()
        WHERE id = ${conversationId}
          AND branch_id = ${branchId}
      `;
      return;
    }
    const conversationRows = await prisma.$queryRaw<Array<{ organizationId: string; messengerAccountId: string | null }>>`
      SELECT organization_id AS "organizationId", messenger_account_id AS "messengerAccountId"
      FROM messenger_conversations
      WHERE id = ${conversationId}
        AND branch_id = ${branchId}
      LIMIT 1
    `;
    const organizationId = conversationRows[0]?.organizationId ?? getMessengerOrganizationId();
    const accountId = conversationRows[0]?.messengerAccountId ?? "unknown";
    const key = messengerObjectKey(
      ["messenger", organizationId, "telegram", "accounts", accountId, "avatars", conversationId],
      "avatar.jpg"
    );
    await putMessengerStorageObject({
      key,
      body: buffer,
      contentType: "image/jpeg",
      cacheControl: "private, max-age=86400",
      contentDisposition: `inline; filename="avatar.jpg"`,
    });
    await prisma.$executeRaw`
      UPDATE messenger_conversations
      SET participant_avatar_url = ${messengerStorageProxyUrl("avatar", conversationId)},
          avatar_storage_key = ${key},
          avatar_thumbnail_key = ${key},
          avatar_status = 'available',
          avatar_updated_at = now(),
          avatar_error = NULL,
          updated_at = now()
      WHERE id = ${conversationId}
        AND branch_id = ${branchId}
    `;
  } catch (error) {
    await prisma.$executeRaw`
      UPDATE messenger_conversations
      SET avatar_status = 'failed',
          avatar_error = ${safeError(error, "Telegram avatar download failed")},
          avatar_updated_at = now(),
          updated_at = now()
      WHERE id = ${conversationId}
        AND branch_id = ${branchId}
    `;
  }
}

async function upsertTelegramDialog(account: MessengerAccount, dialog: TelegramDialog, client?: TelegramRuntimeClient) {
  await ensureTelegramUserSchema();
  const organizationId = account.organizationId ?? getMessengerOrganizationId();
  const chatId = peerId(dialog);
  if (!chatId) return null;
  const entity = dialog.entity ?? {};
  const externalUserId = entity.id === undefined || entity.id === null ? chatId : String(entity.id);
  const title =
    dialog.title ||
    dialog.name ||
    entity.title ||
    [entity.firstName, entity.lastName].filter(Boolean).join(" ") ||
    (entity.username ? `@${entity.username}` : `Telegram ${chatId}`);
  const lastText = messagePreviewText(dialog.message);
  const lastAt = messageDate(dialog.message?.date);
  const conversationId = crypto.randomUUID();
  const externalConversationId = telegramExternalConversationId(account.id, chatId);
  const telegramPeer = telegramPeerSnapshotFromDialog(dialog);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO messenger_conversations
      (id, branch_id, organization_id, messenger_account_id, channel, external_conversation_id, external_chat_id, external_user_id, external_participant_id, title,
       participant_name, participant_username, participant_phone, unread_count, last_message_text, last_message_at, status,
       metadata_json, created_at, updated_at)
    VALUES
      (${conversationId}, ${getScopedBranchId()}, ${organizationId}, ${account.id}, 'telegram', ${externalConversationId}, ${chatId}, ${externalUserId}, ${externalUserId},
       ${title}, ${title}, ${entity.username ?? null}, ${entity.phone ?? null}, ${Number(dialog.unreadCount ?? 0)},
       ${lastText}, ${lastAt}, 'open', ${JSON.stringify({ source: "telegram_user_session", telegramPeer })}::jsonb, now(), now())
    ON CONFLICT (branch_id, channel, external_conversation_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      messenger_account_id = EXCLUDED.messenger_account_id,
      external_chat_id = EXCLUDED.external_chat_id,
      external_user_id = EXCLUDED.external_user_id,
      external_participant_id = EXCLUDED.external_participant_id,
      title = EXCLUDED.title,
      participant_name = EXCLUDED.participant_name,
      participant_username = EXCLUDED.participant_username,
      participant_phone = EXCLUDED.participant_phone,
      unread_count = EXCLUDED.unread_count,
      status = 'open',
      last_message_text = CASE WHEN EXCLUDED.last_message_text <> '' THEN EXCLUDED.last_message_text ELSE messenger_conversations.last_message_text END,
      last_message_at = GREATEST(messenger_conversations.last_message_at, EXCLUDED.last_message_at),
      metadata_json = messenger_conversations.metadata_json || EXCLUDED.metadata_json,
      updated_at = now()
    RETURNING id
  `;
  if (rows[0]?.id) {
    await refreshTelegramDialogAvatar(rows[0].id, dialog.entity ?? dialog.inputEntity, client);
  }
  return { id: rows[0]?.id, chatId, externalConversationId };
}

function telegramUserFromResult(result: unknown, preferredUserId?: string | null) {
  const users = objectField(result, "users");
  if (!Array.isArray(users)) return null;
  const activeUsers = users.filter((user) => {
    if (!user || typeof user !== "object") return false;
    const id = objectField(user, "id");
    const deleted = objectField(user, "deleted");
    return id !== undefined && id !== null && deleted !== true;
  });
  if (preferredUserId) {
    return activeUsers.find((user) => telegramUserId(user) === preferredUserId) ?? activeUsers[0] ?? null;
  }
  return activeUsers[0] ?? null;
}

function telegramImportedUserId(result: unknown) {
  const imported = objectField(result, "imported");
  if (!Array.isArray(imported)) return null;
  for (const item of imported) {
    const userId = stringValue(objectField(item, "userId") ?? objectField(item, "user_id"));
    if (userId) return userId;
  }
  return null;
}

function telegramUserId(user: unknown) {
  return stringValue(objectField(user, "id"));
}

function telegramUserName(user: unknown) {
  const firstName = stringValue(objectField(user, "firstName"));
  const lastName = stringValue(objectField(user, "lastName"));
  const username = stringValue(objectField(user, "username"));
  return [firstName, lastName].filter(Boolean).join(" ") || (username ? `@${username}` : null);
}

function telegramUserMetadata(user: unknown) {
  return {
    id: stringValue(objectField(user, "id")),
    username: stringValue(objectField(user, "username")),
    firstName: stringValue(objectField(user, "firstName")),
    lastName: stringValue(objectField(user, "lastName")),
    phone: stringValue(objectField(user, "phone")),
    className: stringValue(objectField(user, "className")),
  };
}

async function upsertTelegramConversationFromUser(input: {
  account: MessengerAccount;
  user: unknown;
  phone: string;
  source: TelegramResolvedPeer["source"];
}) {
  const organizationId = input.account.organizationId ?? getMessengerOrganizationId();
  const chatId = telegramUserId(input.user);
  if (!chatId) throw new Error("Telegram вернул контакт без user id.");
  const externalUserId = chatId;
  const username = stringValue(objectField(input.user, "username"));
  const displayName = telegramUserName(input.user) ?? `Telegram ${chatId}`;
  const externalConversationId = telegramExternalConversationId(input.account.id, chatId);
  const telegramPeer = telegramPeerSnapshotFromUser(input.user);
  const connectionId = crypto.randomUUID();
  const connectionRows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO messenger_connections
      (id, branch_id, organization_id, channel, type, external_user_id, external_chat_id, external_username, display_name, phone, is_active, last_seen_at, raw_json, updated_at)
    VALUES
      (${connectionId}, ${getScopedBranchId()}, ${organizationId}, 'telegram', 'unknown', ${externalUserId}, ${chatId}, ${username}, ${displayName},
       ${input.phone}, true, now(), ${JSON.stringify({ source: input.source, user: telegramUserMetadata(input.user) })}::jsonb, now())
    ON CONFLICT (branch_id, channel, external_chat_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      external_user_id = COALESCE(EXCLUDED.external_user_id, messenger_connections.external_user_id),
      external_username = COALESCE(EXCLUDED.external_username, messenger_connections.external_username),
      display_name = EXCLUDED.display_name,
      phone = COALESCE(EXCLUDED.phone, messenger_connections.phone),
      is_active = true,
      last_seen_at = now(),
      raw_json = EXCLUDED.raw_json,
      updated_at = now()
    RETURNING id
  `;
  const conversationId = crypto.randomUUID();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO messenger_conversations
      (id, branch_id, organization_id, messenger_account_id, channel, external_conversation_id, external_chat_id, external_user_id,
       external_participant_id, connection_id, title, participant_name, participant_username, participant_phone,
       unread_count, last_message_text, last_message_at, status, metadata_json, created_at, updated_at)
    VALUES
      (${conversationId}, ${getScopedBranchId()}, ${organizationId}, ${input.account.id}, 'telegram', ${externalConversationId}, ${chatId}, ${externalUserId},
       ${externalUserId}, ${connectionRows[0]?.id ?? null}, ${displayName}, ${displayName}, ${username}, ${input.phone},
       0, '', now(), 'open', ${JSON.stringify({ source: input.source, firstContact: true, telegramPeer })}::jsonb, now(), now())
    ON CONFLICT (branch_id, channel, external_conversation_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      messenger_account_id = EXCLUDED.messenger_account_id,
      external_chat_id = EXCLUDED.external_chat_id,
      external_user_id = EXCLUDED.external_user_id,
      external_participant_id = EXCLUDED.external_participant_id,
      connection_id = COALESCE(EXCLUDED.connection_id, messenger_conversations.connection_id),
      title = EXCLUDED.title,
      participant_name = EXCLUDED.participant_name,
      participant_username = COALESCE(EXCLUDED.participant_username, messenger_conversations.participant_username),
      participant_phone = COALESCE(EXCLUDED.participant_phone, messenger_conversations.participant_phone),
      status = 'open',
      metadata_json = messenger_conversations.metadata_json || EXCLUDED.metadata_json,
      updated_at = now()
    RETURNING id
  `;
  return {
    accountId: input.account.id,
    organizationId,
    externalUserId,
    externalConversationId,
    chatId,
    username,
    displayName,
    phone: input.phone,
    source: input.source,
    conversationId: rows[0]?.id ?? conversationId,
  } satisfies TelegramResolvedPeer;
}

export async function resolveTelegramUserPeerByPhone(phoneInput: string): Promise<TelegramResolvedPeer | { ok: false; reason: string; message: string }> {
  const account = await getActiveTelegramUserAccount();
  if (!account || !account.isActive || account.status !== "connected") {
    return {
      ok: false,
      reason: "telegram_not_connected",
      message: "Telegram-аккаунт не подключён. Подключите его в Интеграциях.",
    };
  }
  const phone = normalizePhone(phoneInput);
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    return { ok: false, reason: "phone_missing", message: "У клиента нет корректного телефона для поиска Telegram." };
  }
  const session = await getSessionByAccount(account.id);
  const sessionString = decryptSecret(session?.sessionEncrypted);
  if (!sessionString) {
    return { ok: false, reason: "telegram_session_missing", message: "Telegram user session не найдена. Подключите аккаунт заново." };
  }
  const client = await getClient(sessionString);
  try {
    const { Api } = await loadGramJs();
    const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone })).catch(() => null);
    const resolvedUser = telegramUserFromResult(resolved);
    if (resolvedUser) {
      return upsertTelegramConversationFromUser({ account, user: resolvedUser, phone, source: "phone_lookup" });
    }

    const imported = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: BigInt(Date.now()),
            phone,
            firstName: "Eco",
            lastName: "Contact",
          }),
        ],
      })
    );
    const importedUserId = telegramImportedUserId(imported);
    const importedUser = telegramUserFromResult(imported, importedUserId);
    if (!importedUser) {
      return {
        ok: false,
        reason: "telegram_not_found",
        message: "Не удалось найти Telegram по этому номеру.",
      };
    }
    return upsertTelegramConversationFromUser({ account, user: importedUser, phone, source: "imported_contact" });
  } catch (error) {
    const message = safeError(error, "Telegram не разрешил найти или импортировать контакт");
    const lower = message.toLowerCase();
    if (lower.includes("flood")) {
      return { ok: false, reason: "flood_wait", message: "Telegram временно ограничил поиск контактов. Попробуйте позже." };
    }
    if (lower.includes("privacy") || lower.includes("private")) {
      return {
        ok: false,
        reason: "privacy_restricted",
        message: "Telegram не разрешил написать этому пользователю. Возможны настройки приватности или ограничения Telegram.",
      };
    }
    return {
      ok: false,
      reason: "telegram_lookup_failed",
      message,
    };
  } finally {
    await client.disconnect?.().catch?.(() => {});
  }
}

async function archiveSkippedTelegramConversations(accountId: string, externalConversationIds: string[]) {
  const uniqueIds = [...new Set(externalConversationIds)].filter(Boolean);
  if (!uniqueIds.length) return 0;
  const payload = JSON.stringify(uniqueIds);
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE messenger_conversations
    SET status = 'archived',
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND branch_id = ${getScopedBranchId()}
      AND messenger_account_id = ${accountId}
      AND channel = 'telegram'
      AND status <> 'archived'
      AND external_conversation_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(${payload}::jsonb) AS skipped(external_conversation_id)
        WHERE skipped.external_conversation_id = messenger_conversations.external_conversation_id
      )
    RETURNING id
  `;
  return rows.length;
}

async function upsertTelegramMessage(conversationId: string, message: TelegramMessage) {
  await ensureTelegramUserSchema();
  const conversationRows = await prisma.$queryRaw<Array<{ organizationId: string; messengerAccountId: string | null; externalChatId: string | null }>>`
    SELECT organization_id AS "organizationId", messenger_account_id AS "messengerAccountId", external_chat_id AS "externalChatId"
    FROM messenger_conversations
    WHERE id = ${conversationId}
      AND branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  const organizationId = conversationRows[0]?.organizationId ?? getMessengerOrganizationId();
  const messengerAccountId = conversationRows[0]?.messengerAccountId ?? null;
  const externalChatId = conversationRows[0]?.externalChatId ?? null;
  const rawExternalMessageId = message.id === undefined || message.id === null ? null : String(message.id);
  if (!rawExternalMessageId) return null;
  const externalMessageId = telegramExternalMessageId(conversationId, rawExternalMessageId);
  const text = messageText(message);
  const attachments = normalizeTelegramAttachments(message, externalMessageId);
  const createdAt = messageDate(message.date);
  const direction = message.out ? "outbound" : "inbound";
  const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO messenger_messages
      (id, branch_id, organization_id, conversation_id, messenger_account_id, channel, external_message_id, direction, author_type, message_type, text, attachments_json, status, raw_json,
       sent_at, received_at, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${getScopedBranchId()}, ${organizationId}, ${conversationId}, ${messengerAccountId}, 'telegram', ${externalMessageId}, ${direction},
       ${message.out ? "employee" : "client"}, ${attachments.length ? attachments[0].type : "text"}, ${text}, ${JSON.stringify(attachments)}::jsonb,
       ${message.out ? "sent" : "received"}, ${JSON.stringify({ id: rawExternalMessageId, dedupeId: externalMessageId, hasMedia: Boolean(message.media) })}::jsonb,
       ${message.out ? createdAt : null}, ${message.out ? null : createdAt}, ${createdAt}, now())
    ON CONFLICT (branch_id, channel, external_message_id)
    WHERE external_message_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `;
  const messageId =
    inserted[0]?.id ??
    (
      await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM messenger_messages
        WHERE channel = 'telegram'
          AND branch_id = ${getScopedBranchId()}
          AND external_message_id = ${externalMessageId}
          AND organization_id = ${organizationId}
        LIMIT 1
      `
    )[0]?.id;
  if (messageId && attachments.length) {
    await upsertAttachmentRows({
      organizationId,
      messengerAccountId,
      conversationId,
      messageId,
      channel: "telegram",
      direction,
      externalMessageId,
      externalPeerId: externalChatId,
      attachments,
    });
    await refreshMessageAttachmentsJson(messageId);
  }
  if (inserted[0]?.id) {
    await touchClientCaseMessageState({
      conversationId,
      direction,
      at: createdAt,
      text,
    }).catch((error) => console.warn("[telegram sync] client case touch failed", error));
  }
  return {
    id: messageId ?? null,
    inserted: Boolean(inserted[0]?.id),
    direction,
    text,
    organizationId,
  };
}

function startAgentForSyncedMessages(input: { organizationId: string; conversationId: string; messageId: string; text: string }) {
  // Do not replay a synced Telegram history into the retired client agent.
  if (process.env.CLIENT_AI_AGENT_ENABLED?.trim().toLowerCase() !== "true") return;
  if (!input.text.trim()) return;
  void import("@/lib/ai-agent/runner")
    .then(({ triggerAgentForInboundMessage }) => triggerAgentForInboundMessage(input))
    .catch((error) => console.warn("[ai-agent telegram sync]", error instanceof Error ? error.message : String(error)));
}

function telegramWorkerLeaseMs() {
  const configured = Number(process.env.TELEGRAM_SYNC_WORKER_LEASE_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_WORKER_LEASE_MS;
  return Math.max(60_000, Math.floor(configured));
}

async function claimTelegramWorkerLease(accountId: string) {
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  const expiresAt = new Date(Date.now() + telegramWorkerLeaseMs()).toISOString();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE messenger_accounts
    SET metadata_json = jsonb_set(
          COALESCE(metadata_json, '{}'::jsonb),
          '{telegramSyncWorkerLease}',
          jsonb_build_object('owner', ${TELEGRAM_SYNC_WORKER_OWNER}::text, 'expiresAt', ${expiresAt}::text),
          true
        )
    WHERE id = ${accountId}
      AND organization_id = ${organizationId}
      AND branch_id = ${branchId}
      AND (
        metadata_json #>> '{telegramSyncWorkerLease,expiresAt}' IS NULL
        OR NULLIF(metadata_json #>> '{telegramSyncWorkerLease,expiresAt}', '')::timestamptz <= now()
        OR metadata_json #>> '{telegramSyncWorkerLease,owner}' = ${TELEGRAM_SYNC_WORKER_OWNER}
      )
    RETURNING id
  `;
  return rows.length > 0;
}

async function releaseTelegramWorkerLease(accountId: string) {
  const organizationId = getMessengerOrganizationId();
  const branchId = getScopedBranchId();
  await prisma.$executeRaw`
    UPDATE messenger_accounts
    SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) #- '{telegramSyncWorkerLease}'
    WHERE id = ${accountId}
      AND organization_id = ${organizationId}
      AND branch_id = ${branchId}
      AND metadata_json #>> '{telegramSyncWorkerLease,owner}' = ${TELEGRAM_SYNC_WORKER_OWNER}
  `;
}

async function runTelegramUserAccountSync(accountId?: string, limit = 40, options: { worker?: boolean } = {}) {
  const accounts = accountId
    ? (await listTelegramUserAccounts()).filter((account) => account.id === accountId)
    : (await listTelegramUserAccounts()).filter(
        (account) => (account.status === "connected" || account.status === "degraded") && account.isActive
      );
  const processed = [];
  for (const account of accounts) {
    if (options.worker && account.lastSyncAt) {
      const lastSyncAt = Date.parse(account.lastSyncAt);
      if (Number.isFinite(lastSyncAt) && Date.now() - lastSyncAt < telegramSyncMinIntervalMs()) {
        processed.push({ accountId: account.id, ok: true, skipped: "recently_synced" as const });
        continue;
      }
    }
    const allowAgentTrigger = Boolean(account.lastSyncAt);
    const session = await getSessionByAccount(account.id);
    const sessionString = decryptSecret(session?.sessionEncrypted);
    if (!sessionString) {
      await updateAccountStatus(account.id, "needs_auth", "Telegram session отсутствует. Подключите аккаунт заново.");
      processed.push({ accountId: account.id, ok: false, error: "session missing" });
      continue;
    }
    if (options.worker && !await claimTelegramWorkerLease(account.id)) {
      processed.push({ accountId: account.id, ok: true, skipped: "leased" as const });
      continue;
    }
    let client: TelegramRuntimeClient | null = null;
    let syncSucceeded = false;
    try {
      client = await getClient(sessionString);
      const dialogs = (await client.getDialogs({ limit })) as TelegramDialog[];
      logSyncState("dialogs_fetched", { accountId: account.id, count: dialogs.length, limit });
      let conversationCount = 0;
      let messageCount = 0;
      let skippedCount = 0;
      const skippedExternalConversationIds: string[] = [];
      for (const dialog of dialogs) {
        if (!isConversationDialog(dialog)) {
          const chatId = peerId(dialog);
          if (chatId) skippedExternalConversationIds.push(telegramExternalConversationId(account.id, chatId));
          skippedCount += 1;
          continue;
        }
        const conversation = await upsertTelegramDialog(account, dialog, client);
        if (!conversation?.id) {
          skippedCount += 1;
          continue;
        }
        conversationCount += 1;
        const messages = (await client.getMessages(dialog.inputEntity ?? dialog.entity ?? conversation.chatId, { limit: 30 })) as TelegramMessage[];
        const newInboundMessages: Array<{ id: string; text: string; organizationId: string }> = [];
        for (const message of messages.reverse()) {
          const saved = await upsertTelegramMessage(conversation.id, message);
          if (saved?.inserted && saved.direction === "inbound" && saved.id && saved.text.trim()) {
            newInboundMessages.push({ id: saved.id, text: saved.text, organizationId: saved.organizationId });
          }
          messageCount += 1;
        }
        if (allowAgentTrigger) {
          for (const inbound of newInboundMessages) {
            startAgentForSyncedMessages({
              organizationId: inbound.organizationId,
              conversationId: conversation.id,
              messageId: inbound.id,
              text: inbound.text,
            });
          }
        }
      }
      const archivedCount = await archiveSkippedTelegramConversations(account.id, skippedExternalConversationIds);
      const organizationId = account.organizationId ?? getMessengerOrganizationId();
      await prisma.$executeRaw`
        UPDATE messenger_accounts
        SET status = 'connected', last_sync_at = now(), error_message = NULL, updated_at = now()
        WHERE id = ${account.id}
          AND organization_id = ${organizationId}
          AND branch_id = ${getScopedBranchId()}
      `;
      await prisma.$executeRaw`
        UPDATE telegram_user_sessions
        SET status = 'connected', last_sync_at = now(), error_message = NULL, updated_at = now()
        WHERE messenger_account_id = ${account.id}
          AND organization_id = ${organizationId}
          AND branch_id = ${getScopedBranchId()}
      `;
      await recordIntegrationAudit({ channel: "telegram_user", action: "telegram_user_sync_verified", metadata: { accountId: account.id } });
      logSyncState("dialogs_saved", { accountId: account.id, dialogsFetched: dialogs.length, conversationCount, messageCount, skippedCount, archivedCount });
      processed.push({ accountId: account.id, ok: true, conversationCount, messageCount, skippedCount, archivedCount });
      syncSucceeded = true;
    } catch (error) {
      const message = safeError(error, "Telegram sync failed");
      await updateAccountStatus(account.id, /AUTH|SESSION|PASSWORD/i.test(message) ? "needs_auth" : "degraded", message);
      processed.push({ accountId: account.id, ok: false, error: message });
    } finally {
      if (client) await disconnectTelegramClient(client);
      // A successful run releases the lease immediately. On transport failure
      // it remains until expiry, forming a cross-replica cooldown.
      if (options.worker && syncSucceeded) {
        await releaseTelegramWorkerLease(account.id).catch((error) => {
          console.warn("[messenger.telegram_user.worker]", JSON.stringify({
            action: "lease_release_failed",
            accountId: account.id,
            error: safeError(error, "Telegram worker lease release failed"),
          }));
        });
      }
    }
  }
  return { ok: true as const, processed };
}

type TelegramUserSyncResult = Awaited<ReturnType<typeof runTelegramUserAccountSync>>;
type TelegramSyncRuntimeEntry = {
  inFlight: Promise<TelegramUserSyncResult> | null;
  lastStartedAt: number;
  consecutiveFailures: number;
  nextRetryAt: number;
};

const telegramSyncRuntimeGlobal = globalThis as typeof globalThis & {
  __ecoTelegramUserSyncRuntime?: Map<string, TelegramSyncRuntimeEntry>;
};

function telegramSyncRuntime() {
  telegramSyncRuntimeGlobal.__ecoTelegramUserSyncRuntime ??= new Map<string, TelegramSyncRuntimeEntry>();
  return telegramSyncRuntimeGlobal.__ecoTelegramUserSyncRuntime;
}

function telegramSyncMinIntervalMs() {
  const configured = Number(process.env.TELEGRAM_SYNC_MIN_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured < 10_000) return 60_000;
  return Math.floor(configured);
}

function telegramSyncMaxBackoffMs() {
  const minimum = telegramSyncMinIntervalMs();
  const configured = Number(process.env.TELEGRAM_SYNC_MAX_BACKOFF_MS);
  if (!Number.isFinite(configured) || configured < minimum) return Math.max(minimum, 6 * 60 * 60_000);
  return Math.floor(configured);
}

function telegramSyncFailureBackoffMs(consecutiveFailures: number) {
  const exponent = Math.min(Math.max(0, consecutiveFailures - 1), 10);
  return Math.min(telegramSyncMaxBackoffMs(), telegramSyncMinIntervalMs() * 2 ** exponent);
}

function telegramSyncResultFailed(result: TelegramUserSyncResult) {
  return result.processed.some((item) => !item.ok);
}

function recordTelegramSyncFailure(entry: TelegramSyncRuntimeEntry) {
  entry.consecutiveFailures += 1;
  entry.nextRetryAt = Date.now() + telegramSyncFailureBackoffMs(entry.consecutiveFailures);
}

function clearTelegramSyncFailure(entry: TelegramSyncRuntimeEntry) {
  entry.consecutiveFailures = 0;
  entry.nextRetryAt = 0;
}

export async function syncTelegramUserAccount(accountId?: string, limit = 40, options: { force?: boolean; worker?: boolean } = {}) {
  const runtime = telegramSyncRuntime();
  const runtimeKey = `${getMessengerOrganizationId()}:${getScopedBranchId()}:telegram-user-session`;
  const entry = runtime.get(runtimeKey) ?? { inFlight: null, lastStartedAt: 0, consecutiveFailures: 0, nextRetryAt: 0 };

  if (entry.inFlight) return entry.inFlight;

  const now = Date.now();
  const intervalRetryAt = entry.lastStartedAt + telegramSyncMinIntervalMs();
  const retryAt = Math.max(intervalRetryAt, entry.nextRetryAt);
  const retryAfterMs = Math.max(0, retryAt - now);
  if (!options.force && retryAfterMs > 0) {
    return {
      ok: true as const,
      processed: [],
      skipped: entry.nextRetryAt > now ? "backoff" as const : "throttled" as const,
      retryAfterMs,
    };
  }

  entry.lastStartedAt = now;
  const inFlight = runTelegramUserAccountSync(accountId, limit, { worker: options.worker });
  entry.inFlight = inFlight;
  runtime.set(runtimeKey, entry);

  try {
    const result = await inFlight;
    if (telegramSyncResultFailed(result)) recordTelegramSyncFailure(entry);
    else clearTelegramSyncFailure(entry);
    return result;
  } catch (error) {
    recordTelegramSyncFailure(entry);
    throw error;
  } finally {
    if (entry.inFlight === inFlight) entry.inFlight = null;
  }
}

export async function sendTelegramUserText(outbox: MessageOutbox): Promise<ChannelSendResult> {
  const accountId = await accountIdForOutbox(outbox);
  if (!accountId) return { ok: false, error: "Telegram user account is not connected" };
  const session = await getSessionByAccount(accountId);
  const sessionString = decryptSecret(session?.sessionEncrypted);
  if (!sessionString) return { ok: false, error: "Telegram user session is missing" };
  const client = await getClient(sessionString);
  try {
    const target = await telegramSendTarget(client, outbox);
    const result = await client.sendMessage(target, { message: telegramUserText(outbox), ...(await telegramUserSendOptions(outbox)) });
    return { ok: true, status: "sent", channelMessageId: result?.id ? String(result.id) : undefined };
  } catch (error) {
    return { ok: false, error: safeError(error, "Telegram sendMessage failed") };
  } finally {
    await disconnectTelegramClient(client);
  }
}

function telegramUserText(outbox: MessageOutbox) {
  return outbox.text;
}

async function telegramUserSendOptions(outbox: MessageOutbox) {
  const telegram =
    outbox.templateVarsJson && typeof outbox.templateVarsJson.telegram === "object" && outbox.templateVarsJson.telegram
      ? (outbox.templateVarsJson.telegram as Record<string, unknown>)
      : {};
  const { Api } = await loadGramJs();
  const formattingEntities: unknown[] = [];
  if (Array.isArray(telegram.boldRanges)) {
    for (const range of telegram.boldRanges) {
      if (!range || typeof range !== "object") continue;
      const row = range as { offset?: unknown; length?: unknown };
      const offset = Number(row.offset);
      const length = Number(row.length);
      if (Number.isFinite(offset) && Number.isFinite(length) && length > 0) {
        formattingEntities.push(new Api.MessageEntityBold({ offset, length }));
      }
    }
  }
  if (Array.isArray(telegram.textLinks)) {
    for (const link of telegram.textLinks) {
      if (!link || typeof link !== "object") continue;
      const row = link as { offset?: unknown; length?: unknown; url?: unknown };
      const offset = Number(row.offset);
      const length = Number(row.length);
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (Number.isFinite(offset) && Number.isFinite(length) && length > 0 && /^https?:\/\//iu.test(url)) {
        formattingEntities.push(new Api.MessageEntityTextUrl({ offset, length, url }));
      }
    }
  }
  return {
    ...(typeof telegram.disableWebPagePreview === "boolean" ? { linkPreview: !telegram.disableWebPagePreview } : {}),
    ...(formattingEntities.length ? { formattingEntities } : {}),
  };
}

async function accountIdForOutbox(outbox: MessageOutbox) {
  if ("messengerAccountId" in outbox && typeof (outbox as MessageOutbox & { messengerAccountId?: unknown }).messengerAccountId === "string") {
    return (outbox as MessageOutbox & { messengerAccountId: string }).messengerAccountId;
  }
  if (outbox.conversationId) {
    const organizationId = outbox.organizationId ?? getMessengerOrganizationId();
    const rows = await prisma.$queryRaw<Array<{ messengerAccountId: string | null }>>`
      SELECT messenger_account_id AS "messengerAccountId"
      FROM messenger_conversations
      WHERE id = ${outbox.conversationId}
        AND organization_id = ${organizationId}
        AND branch_id = ${getScopedBranchId()}
      LIMIT 1
    `;
    if (rows[0]?.messengerAccountId) return rows[0].messengerAccountId;
  }
  const account = await getActiveTelegramUserAccount();
  return account?.id ?? null;
}

function rawTelegramMessageId(value: string | null | undefined) {
  if (!value) return null;
  const last = value.split(":").at(-1);
  const parsed = Number(last);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extensionFromName(name: string | null | undefined) {
  const match = name?.match(/\.([a-zA-Z0-9]{1,12})$/);
  return match?.[1]?.toLowerCase() ?? null;
}

function mimeFromBytes(buffer: Buffer, fallback?: string | null) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return fallback || "application/octet-stream";
}

function mediaLimitBytes(type: string, direction: "download" | "upload") {
  const isPhoto = isPhotoAttachmentType(type);
  const envName =
    direction === "upload"
      ? "MESSENGER_UPLOAD_MAX_MB"
      : isPhoto
        ? "MESSENGER_AUTO_DOWNLOAD_IMAGE_MAX_MB"
        : "MESSENGER_AUTO_DOWNLOAD_FILE_MAX_MB";
  const fallbackMb = direction === "upload" ? 20 : isPhoto ? 15 : 25;
  const mb = Number(process.env[envName] ?? fallbackMb);
  return Math.max(1, Number.isFinite(mb) ? mb : fallbackMb) * 1024 * 1024;
}

function telegramChatIdForConversation(value: string | null | undefined) {
  return value?.replace(/^telegram:user:[^:]+:/, "").replace(/^telegram:/, "") ?? "";
}

function telegramEntityLookupKey(externalConversationId: string) {
  const chatId = telegramChatIdForConversation(externalConversationId).trim();
  if (!chatId) throw new Error("Telegram chat id is missing");
  const numericId = Number(chatId);
  return /^-?\d+$/.test(chatId) && Number.isSafeInteger(numericId) ? numericId : chatId;
}

function telegramLong(value: unknown) {
  const text = stringValue(value)?.replace(/n$/, "");
  if (!text || !/^-?\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function telegramPeerSnapshotFromUnknown(value: unknown): TelegramPeerSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    id: stringValue(raw.id),
    chatId: stringValue(raw.chatId),
    accessHash: stringValue(raw.accessHash),
    type: raw.type === "user" || raw.type === "chat" || raw.type === "channel" ? raw.type : null,
    username: stringValue(raw.username),
    phone: stringValue(raw.phone),
    className: stringValue(raw.className),
    inputClassName: stringValue(raw.inputClassName),
  };
}

async function telegramInputPeerFromSnapshot(peer: TelegramPeerSnapshot | null | undefined) {
  if (!peer) return null;
  const id = telegramLong(peer.id ?? peer.chatId);
  if (!id) return null;
  const accessHash = telegramLong(peer.accessHash);
  const { Api } = await loadGramJs();
  if (peer.type === "channel" && accessHash) {
    return new Api.InputPeerChannel({ channelId: id, accessHash });
  }
  if (peer.type === "chat") {
    return new Api.InputPeerChat({ chatId: id });
  }
  if (accessHash) {
    return new Api.InputPeerUser({ userId: id, accessHash });
  }
  return null;
}

async function telegramGetInputEntitySafe(client: TelegramRuntimeClient, value: unknown) {
  if (!client.getInputEntity || value === undefined || value === null || value === "") return null;
  try {
    return await client.getInputEntity(value);
  } catch {
    return null;
  }
}

async function telegramConversationPeer(outbox: MessageOutbox): Promise<TelegramPeerSnapshot | null> {
  if (!outbox.conversationId) return null;
  const rows = await prisma.$queryRaw<
    Array<{
      externalChatId: string | null;
      participantUsername: string | null;
      participantPhone: string | null;
      clientPhone: string | null;
      clientNormalizedPhone: string | null;
      supplierPhone: string | null;
      supplierNormalizedPhone: string | null;
      metadataJson: Record<string, unknown> | null;
    }>
  >`
    SELECT
      mc.external_chat_id AS "externalChatId",
      mc.participant_username AS "participantUsername",
      mc.participant_phone AS "participantPhone",
      client.phone AS "clientPhone",
      client.normalized_phone AS "clientNormalizedPhone",
      supplier.phone AS "supplierPhone",
      supplier.normalized_phone AS "supplierNormalizedPhone",
      mc.metadata_json AS "metadataJson"
    FROM messenger_conversations mc
    LEFT JOIN local_counterparties client
      ON client.id = mc.client_id OR client.legacy_id = mc.client_id
    LEFT JOIN local_counterparties supplier
      ON supplier.id = mc.supplier_id OR supplier.legacy_id = mc.supplier_id
    WHERE mc.id = ${outbox.conversationId}
      AND mc.organization_id = ${outbox.organizationId ?? getMessengerOrganizationId()}
      AND mc.branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const stored = telegramPeerSnapshotFromUnknown(objectField(row.metadataJson, "telegramPeer"));
  const chatId = stored?.chatId ?? row.externalChatId ?? telegramChatIdForConversation(outbox.recipientExternalChatId) ?? null;
  return {
    ...stored,
    id: stored?.id ?? chatId,
    chatId,
    username: stored?.username ?? row.participantUsername ?? null,
    phone:
      stored?.phone ??
      row.participantPhone ??
      row.clientPhone ??
      row.clientNormalizedPhone ??
      row.supplierPhone ??
      row.supplierNormalizedPhone ??
      null,
  };
}

async function saveTelegramConversationPeer(conversationId: string | null | undefined, organizationId: string, peer: TelegramPeerSnapshot) {
  if (!conversationId) return;
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET external_chat_id = COALESCE(${peer.chatId ?? peer.id ?? null}, external_chat_id),
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || ${JSON.stringify({ telegramPeer: peer })}::jsonb,
        updated_at = now()
    WHERE id = ${conversationId}
      AND organization_id = ${organizationId}
      AND branch_id = ${getScopedBranchId()}
  `;
}

async function telegramRefreshDialogTarget(client: TelegramRuntimeClient, outbox: MessageOutbox) {
  const expectedChatId = telegramChatIdForConversation(outbox.recipientExternalChatId);
  if (!expectedChatId) return null;
  const dialogs = (await client.getDialogs({ limit: 300 })) as TelegramDialog[];
  for (const dialog of dialogs) {
    const peer = telegramPeerSnapshotFromDialog(dialog);
    const candidates = new Set([peer.chatId, peer.id, peerId(dialog)].filter(Boolean));
    if (!candidates.has(expectedChatId)) continue;
    await saveTelegramConversationPeer(outbox.conversationId, outbox.organizationId ?? getMessengerOrganizationId(), peer);
    return dialog.inputEntity ?? dialog.entity ?? (await telegramInputPeerFromSnapshot(peer));
  }
  return null;
}

async function telegramResolvePhoneTarget(client: TelegramRuntimeClient, outbox: MessageOutbox, peer: TelegramPeerSnapshot | null) {
  const phone = normalizePhone(peer?.phone ?? "");
  if (!phone || phone.replace(/\D/g, "").length < 10) return null;
  const { Api } = await loadGramJs();
  const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone })).catch(() => null);
  let user = telegramUserFromResult(resolved);
  if (!user) {
    const imported = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: BigInt(Date.now()),
            phone,
            firstName: "CRM",
            lastName: "Contact",
          }),
        ],
      })
    ).catch(() => null);
    user = telegramUserFromResult(imported, telegramImportedUserId(imported));
  }
  if (!user) return null;
  const nextPeer = telegramPeerSnapshotFromUser(user);
  await saveTelegramConversationPeer(outbox.conversationId, outbox.organizationId ?? getMessengerOrganizationId(), {
    ...nextPeer,
    phone,
  });
  return telegramInputPeerFromSnapshot(nextPeer) ?? telegramGetInputEntitySafe(client, nextPeer.username ? `@${nextPeer.username}` : nextPeer.id);
}

async function telegramSendTarget(client: TelegramRuntimeClient, outbox: MessageOutbox) {
  const lookupKey = telegramEntityLookupKey(outbox.recipientExternalChatId);
  const peer = await telegramConversationPeer(outbox);
  const directPeer = await telegramInputPeerFromSnapshot(peer);
  if (directPeer) return directPeer;

  const username = peer?.username ? (peer.username.startsWith("@") ? peer.username : `@${peer.username}`) : "";
  const byUsername = await telegramGetInputEntitySafe(client, username);
  if (byUsername) return byUsername;

  const byId = await telegramGetInputEntitySafe(client, lookupKey);
  if (byId) return byId;

  const refreshed = await telegramRefreshDialogTarget(client, outbox);
  if (refreshed) return refreshed;

  const byPhone = await telegramResolvePhoneTarget(client, outbox, peer);
  if (byPhone) return byPhone;

  throw new Error("Telegram не нашёл этот диалог в текущей сессии и не смог восстановить его по телефону клиента.");
}

async function setAttachmentTerminalStatus(input: {
  attachmentId: string;
  organizationId: string;
  status: "failed" | "too_large" | "unsupported";
  message: string;
  code?: string;
}) {
  await prisma.$executeRaw`
    UPDATE messenger_attachments
    SET status = ${input.status},
        error_code = ${input.code ?? input.status},
        error_message = ${input.message},
        progress = 100,
        updated_at = now()
    WHERE id = ${input.attachmentId}
      AND organization_id = ${input.organizationId}
      AND branch_id = ${getScopedBranchId()}
  `;
  const rows = await prisma.$queryRaw<Array<{ messageId: string }>>`
    SELECT message_id AS "messageId"
    FROM messenger_attachments
    WHERE id = ${input.attachmentId}
      AND organization_id = ${input.organizationId}
      AND branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  if (rows[0]?.messageId) await refreshMessageAttachmentsJson(rows[0].messageId);
}

export async function downloadTelegramAttachmentMedia(attachmentId: string) {
  await ensureTelegramUserSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      messageId: string;
      conversationId: string | null;
      messengerAccountId: string | null;
      type: string;
      name: string | null;
      size: number | null;
      mimeType: string | null;
      externalMessageId: string | null;
      externalPeerId: string | null;
      metadataJson: Record<string, unknown> | null;
      conversationExternalChatId: string | null;
      conversationExternalConversationId: string | null;
      messageExternalMessageId: string | null;
    }>
  >`
    SELECT
      a.id,
      a.message_id AS "messageId",
      a.conversation_id AS "conversationId",
      a.messenger_account_id AS "messengerAccountId",
      a.type,
      a.name,
      a.size,
      a.mime_type AS "mimeType",
      a.external_message_id AS "externalMessageId",
      a.external_peer_id AS "externalPeerId",
      a.metadata_json AS "metadataJson",
      c.external_chat_id AS "conversationExternalChatId",
      c.external_conversation_id AS "conversationExternalConversationId",
      m.external_message_id AS "messageExternalMessageId"
    FROM messenger_attachments a
    JOIN messenger_messages m ON m.id = a.message_id
    JOIN messenger_conversations c ON c.id = m.conversation_id
    WHERE a.id = ${attachmentId}
      AND a.organization_id = ${organizationId}
      AND a.branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Telegram attachment не найден.");
  if (!messengerStorageStatus().configured) {
    await setAttachmentTerminalStatus({
      attachmentId,
      organizationId,
      status: "failed",
      code: "storage_not_configured",
      message: "Object storage для Messenger не настроен.",
    });
    throw new Error("Object storage для Messenger не настроен.");
  }
  const accountId = row.messengerAccountId;
  if (!accountId) throw new Error("Telegram attachment не привязан к messenger account.");
  const session = await getSessionByAccount(accountId);
  const sessionString = decryptSecret(session?.sessionEncrypted);
  if (!sessionString) throw new Error("Telegram user session отсутствует.");
  const telegramMessageId = rawTelegramMessageId(row.externalMessageId ?? row.messageExternalMessageId);
  if (!telegramMessageId) throw new Error("Telegram message id для вложения не найден.");
  const chatId = row.externalPeerId || row.conversationExternalChatId || telegramChatIdForConversation(row.conversationExternalConversationId);
  if (!chatId) throw new Error("Telegram chat id для вложения не найден.");

  await prisma.$executeRaw`
    UPDATE messenger_attachments
    SET status = 'downloading',
        progress = 10,
        attempts = attempts + 1,
        last_attempt_at = now(),
        error_code = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = ${attachmentId}
      AND organization_id = ${organizationId}
      AND branch_id = ${getScopedBranchId()}
  `;

  const client = await getClient(sessionString);
  try {
    const messages = (await client.getMessages(chatId, { ids: telegramMessageId })) as unknown;
    const list = Array.isArray(messages) ? messages : Object.values(messages as Record<string, unknown>);
    const message = list[0];
    if (!message) throw new Error("Telegram message для скачивания не найден.");
    if (!client.downloadMedia) throw new Error("GramJS downloadMedia недоступен.");
    const media = await client.downloadMedia(message, {});
    if (!Buffer.isBuffer(media)) throw new Error("Telegram вернул неподдерживаемый тип media.");
    if (!media.length) throw new Error("Telegram вернул пустой файл.");
    const limit = mediaLimitBytes(row.type, "download");
    if (media.length > limit) {
      await setAttachmentTerminalStatus({
        attachmentId,
        organizationId,
        status: "too_large",
        code: "file_too_large",
        message: `Файл больше лимита автозагрузки (${Math.round(limit / 1024 / 1024)} МБ).`,
      });
      return { ok: false as const, status: "too_large" };
    }
    const mimeType = mimeFromBytes(media, row.mimeType);
    const extension = extensionFromName(row.name) ?? telegramFileExtension(mimeType, row.type as Attachment["type"]);
    const storageFileName = row.name && extensionFromName(row.name) ? row.name : `${row.type}-${attachmentId}.${extension}`;
    const fileName = safeStorageFileName(storageFileName);
    const key = messengerObjectKey(
      ["messenger", organizationId, "telegram", "accounts", accountId, "conversations", row.conversationId, "attachments", attachmentId],
      fileName
    );
    await putMessengerStorageObject({
      key,
      body: media,
      contentType: mimeType,
      cacheControl: "private, max-age=31536000, immutable",
      contentDisposition: `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    const thumbnailKey = isPhotoAttachmentType(row.type) ? key : null;
    await prisma.$executeRaw`
      UPDATE messenger_attachments
      SET status = 'ready',
          progress = 100,
          size = ${media.length},
          mime_type = ${mimeType},
          name = COALESCE(name, ${fileName}),
          original_storage_key = ${key},
          thumbnail_storage_key = ${thumbnailKey},
          url = ${messengerStorageProxyUrl("attachment", attachmentId)},
          preview_url = ${thumbnailKey ? messengerStorageProxyUrl("thumbnail", attachmentId) : null},
          error_code = NULL,
          error_message = NULL,
          metadata_json = metadata_json || ${JSON.stringify({ storage: { key, thumbnailKey, mimeType, size: media.length } })}::jsonb,
          updated_at = now()
      WHERE id = ${attachmentId}
        AND organization_id = ${organizationId}
        AND branch_id = ${getScopedBranchId()}
    `;
    await refreshMessageAttachmentsJson(row.messageId);
    return { ok: true as const, key, size: media.length };
  } finally {
    await disconnectTelegramClient(client);
  }
}

export async function sendTelegramUserFile(outbox: MessageOutbox): Promise<ChannelSendResult> {
  const accountId = await accountIdForOutbox(outbox);
  if (!accountId) return { ok: false, error: "Telegram user account is not connected" };
  const session = await getSessionByAccount(accountId);
  const sessionString = decryptSecret(session?.sessionEncrypted);
  if (!sessionString) return { ok: false, error: "Telegram user session is missing" };
  const attachment = outbox.attachmentsJson?.[0];
  if (!attachment?.id) return { ok: false, error: "Attachment is missing" };
  const rows = await prisma.$queryRaw<
    Array<{ originalStorageKey: string | null; type: string; name: string | null; size: number | null; mimeType: string | null }>
  >`
    SELECT original_storage_key AS "originalStorageKey", type, name, size, mime_type AS "mimeType"
    FROM messenger_attachments
    WHERE id = ${attachment.id}
      AND organization_id = ${outbox.organizationId ?? getMessengerOrganizationId()}
      AND branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  const stored = rows[0];
  if (!stored?.originalStorageKey) return { ok: false, error: "Attachment file is not stored yet" };
  const object = await getMessengerStorageObject(stored.originalStorageKey);
  const limit = mediaLimitBytes(stored.type, "upload");
  if (object.body.length > limit) return { ok: false, error: `Файл больше лимита отправки (${Math.round(limit / 1024 / 1024)} МБ)` };
  const client = await getClient(sessionString);
  try {
    if (!client.sendFile) throw new Error("GramJS sendFile недоступен.");
    const target = await telegramSendTarget(client, outbox);
    const result = await client.sendFile(target, {
      file: object.body,
      caption: outbox.text || attachment.caption || "",
      forceDocument: !isPhotoAttachmentType(stored.type),
      fileSize: object.body.length,
      workers: 1,
    });
    return { ok: true, status: "sent", channelMessageId: result?.id ? String(result.id) : undefined };
  } catch (error) {
    return { ok: false, error: safeError(error, "Telegram sendFile failed") };
  } finally {
    await disconnectTelegramClient(client);
  }
}

export async function disconnectTelegramUserAccount(accountId: string) {
  const organizationId = getMessengerOrganizationId();
  await updateAccountStatus(accountId, "disconnected", null);
  await prisma.$executeRaw`
    UPDATE telegram_user_sessions
    SET session_encrypted = NULL,
        phone_code_hash_encrypted = NULL,
        qr_token_encrypted = NULL,
        qr_expires_at = NULL,
        updated_at = now()
    WHERE messenger_account_id = ${accountId}
      AND organization_id = ${organizationId}
      AND branch_id = ${getScopedBranchId()}
  `;
  await recordIntegrationAudit({ channel: "telegram_user", action: "telegram_user_disconnected", metadata: { accountId, historyPreserved: true } });
  await notifyIntegrationOwner({ channel: "telegram_user", eventKey: "account_disconnected", entityId: accountId, message: "Рабочий Telegram филиала отключён. История переписки сохранена.", throttleMinutes: 5 });
  return { ok: true as const };
}

export async function getTelegramUserRuntimeConfig() {
  const account = await getActiveTelegramUserAccount();
  const configured = await resolveTelegramUserCredentials().then(() => true).catch(() => false);
  return {
    mode: "user_session",
    enabled: configured,
    configured,
    connectionStatus: statusToConnection(account?.status),
    account,
  };
}

async function validateTelegramUserSessionConfig() {
  const config = await getTelegramUserRuntimeConfig();
  if (!config.configured) return { ok: false as const, status: "not_connected" as const, error: "API ID/API Hash не настроены для текущего филиала", details: config };
  if (config.account?.status !== "connected") return { ok: false as const, status: config.connectionStatus, error: "Рабочий Telegram-аккаунт не подключён", details: config };
  return { ok: true as const, status: "connected" as const, details: config };
}

export const telegramUserSessionAdapter: MessengerChannelAdapter = {
  channel: "telegram",
  getConnection(): MessengerConnection {
    return {
      id: "conn-telegram-user-session",
      channel: "telegram",
      type: "unknown",
      externalChatId: "telegram:user-session",
      displayName: "Рабочий Telegram-аккаунт",
      isActive: true,
      connectionStatus: "not_connected",
      label: "Telegram",
      config: {
        mode: "user_session",
        enabled: true,
        configured: false,
      },
    };
  },
  async sendMessage(outbox) {
    if (outbox.messageType === "image" || outbox.messageType === "file" || outbox.attachmentsJson?.length) {
      return sendTelegramUserFile(outbox);
    }
    return sendTelegramUserText(outbox);
  },
  async validateConfig() {
    return validateTelegramUserSessionConfig();
  },
  validatePlatformConfig() {
    return validateTelegramUserSessionConfig();
  },
  async startOnboarding() {
    const config = await getTelegramUserRuntimeConfig();
    return { ok: true, status: "ready", nextStep: "telegram_user_session", details: config };
  },
  async completeOnboarding() {
    return { ok: false, status: "use_telegram_user_session_routes", error: "Используйте start-auth/confirm-code/confirm-password или QR flow." };
  },
  async disconnect(input) {
    if (!input?.accountId) return { ok: false, error: "accountId required" };
    return disconnectTelegramUserAccount(input.accountId);
  },
  async reconnect(input) {
    return { ok: true, status: "reconnect_required", details: { accountId: input?.accountId ?? null } };
  },
  async testConnection() {
    return validateTelegramUserSessionConfig();
  },
  async syncConversations(input) {
    const result = await syncTelegramUserAccount(input?.accountId, input?.limit ?? 40);
    const first = result.processed[0];
    if (first?.ok === false) return { ok: false, accountId: first.accountId, error: first.error ?? "Telegram sync failed" };
    return {
      ok: true,
      accountId: first?.accountId,
      conversationCount: first?.conversationCount ?? 0,
      messageCount: first?.messageCount ?? 0,
    };
  },
  async syncMessages(input) {
    const result = await syncTelegramUserAccount(input?.accountId, input?.limit ?? 40);
    const first = result.processed[0];
    if (first?.ok === false) return { ok: false, accountId: first.accountId, error: first.error ?? "Telegram sync failed" };
    return { ok: true, accountId: first?.accountId, conversationCount: first?.conversationCount ?? 0, messageCount: first?.messageCount ?? 0 };
  },
  getCapabilities() {
    return {
      channel: "telegram",
      allowedMode: "Рабочий Telegram-аккаунт / User Session / MTProto",
      inbound: "Supported",
      outbound: "Supported",
      realtime: "Partially supported",
      access: "Supported",
      summary: "Клиент пишет в обычный рабочий Telegram, оператор отвечает из Эко-платформы.",
    };
  },
};
