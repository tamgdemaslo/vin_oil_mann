import { prisma } from "@/lib/db";
import type { Conversation, IncomingMessageEvent, Message, MessengerConnection, MessageOutbox } from "../messenger-types";
import { getTelegramStoredSettings, publicTelegramSettings } from "../messenger-channel-settings";
import type { ChannelSendResult, MessengerChannelAdapter } from "./types";

type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id?: number;
  type?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id?: number;
  date?: number;
  chat?: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: {
    id?: string;
    message?: TelegramMessage;
    data?: string;
    from?: TelegramUser;
  };
};

type TelegramApiOk<T> = { ok: true; result: T };
type TelegramApiError = { ok: false; description?: string; error_code?: number; parameters?: Record<string, unknown> };
type TelegramApiResponse<T> = TelegramApiOk<T> | TelegramApiError;

type TelegramSendResult = ChannelSendResult;

type TelegramSendBaseParams = {
  conversation?: Pick<Conversation, "id" | "externalConversationId" | "channel"> | null;
  message?: Pick<Message, "id" | "text" | "channelMessageId"> | null;
  outbox?: MessageOutbox | null;
  connection?: Pick<MessengerConnection, "id" | "externalChatId" | "isActive"> | null;
  externalChatId?: string | null;
  text?: string;
  caption?: string;
};

type TelegramSendTextParams = TelegramSendBaseParams & {
  text: string;
};

type TelegramSendPhotoParams = TelegramSendBaseParams & {
  photoUrl: string;
};

type TelegramSendDocumentParams = TelegramSendBaseParams & {
  documentUrl: string;
  fileName?: string;
};

type TelegramSendTemplateParams = TelegramSendBaseParams & {
  templateText: string;
  variables?: Record<string, string | number | boolean | null | undefined>;
};

type TelegramWebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

function envBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
}

function envBotUsername() {
  return process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "";
}

function envTelegramEnabled() {
  return process.env.TELEGRAM_ENABLED === "true";
}

function envTelegramDryRun() {
  return process.env.TELEGRAM_DRY_RUN === "true";
}

function envWebhookUrl() {
  return process.env.TELEGRAM_WEBHOOK_URL?.trim() ?? "";
}

function telegramApiUrl(method: string, token: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

function redactTelegramSecrets(value: string) {
  const token = envBotToken();
  return token ? value.split(token).join("[telegram-token]") : value;
}

function normalizeExternalChatId(value: string) {
  return value.replace(/^telegram:/, "").replace(/^tg:/, "");
}

function externalConversationIdFromParams(params: TelegramSendBaseParams) {
  return params.externalChatId ?? params.connection?.externalChatId ?? params.outbox?.recipientExternalChatId ?? params.conversation?.externalConversationId ?? null;
}

async function loadConnectionByExternalChatId(externalChatId: string | null) {
  if (!externalChatId) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string; externalChatId: string; isActive: boolean }>>`
    SELECT id, external_chat_id AS "externalChatId", is_active AS "isActive"
    FROM messenger_connections
    WHERE channel = 'telegram'
      AND external_chat_id = ${externalChatId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function isTelegramChatClosed(result: TelegramApiError) {
  const description = result.description ?? "";
  return (
    result.error_code === 403 ||
    /bot was blocked|user is deactivated|chat not found|forbidden/i.test(description)
  );
}

async function markConnectionInactive(externalChatId: string | null, error: string) {
  if (!externalChatId) return;
  const safeError = redactTelegramSecrets(error);
  await prisma.$executeRaw`
    UPDATE messenger_connections
    SET is_active = false,
        blocked_at = COALESCE(blocked_at, now()),
        raw_json = COALESCE(raw_json, '{}'::jsonb) || ${JSON.stringify({ lastTelegramError: safeError })}::jsonb,
        updated_at = now()
    WHERE channel = 'telegram'
      AND external_chat_id = ${externalChatId}
  `;
  await prisma.$executeRaw`
    UPDATE messenger_conversations
    SET status = 'blocked',
        updated_at = now()
    WHERE channel = 'telegram'
      AND external_conversation_id = ${externalChatId}
  `;
}

function skipped(reason: string): TelegramSendResult {
  return { ok: true, status: "skipped", raw: { skipped: true, reason } };
}

async function assertCanSend(params: TelegramSendBaseParams) {
  const settings = await getTelegramStoredSettings();
  if (!settings.enabled) return { ok: false as const, error: "Telegram adapter is disabled" };
  const externalChatId = externalConversationIdFromParams(params);
  if (!externalChatId) return { ok: false as const, error: "Telegram chat_id is missing" };
  if (params.connection && !params.connection.isActive) return skipped("Telegram connection is inactive");
  const dbConnection = params.connection ? null : await loadConnectionByExternalChatId(externalChatId);
  if (dbConnection && !dbConnection.isActive) return skipped("Telegram connection is inactive");
  return { ok: true as const, externalChatId };
}

async function telegramApiRequest<T>(method: string, body?: Record<string, unknown>): Promise<TelegramApiResponse<T>> {
  const settings = await getTelegramStoredSettings();
  const token = settings.botToken ?? "";
  if (!settings.enabled) return { ok: false, description: "Telegram adapter is disabled" };
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not configured" };
  const res = await fetch(telegramApiUrl(method, token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const raw = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (raw?.ok) return raw;
  return {
    ok: false,
    description:
      raw && "description" in raw && typeof raw.description === "string"
        ? raw.description
        : `Telegram ${method} failed (${res.status})`,
    error_code: raw && "error_code" in raw ? raw.error_code : undefined,
    parameters: raw && "parameters" in raw ? raw.parameters : undefined,
  };
}

function telegramFailure(result: TelegramApiError, fallback: string): Extract<TelegramSendResult, { ok: false }> {
  return {
    ok: false,
    error: redactTelegramSecrets(result.description ?? fallback),
    raw: { errorCode: result.error_code, parameters: result.parameters },
  };
}

function telegramOptionsFromOutbox(outbox?: MessageOutbox | null) {
  const telegram =
    outbox?.templateVarsJson && typeof outbox.templateVarsJson.telegram === "object" && outbox.templateVarsJson.telegram
      ? (outbox.templateVarsJson.telegram as Record<string, unknown>)
      : {};
  const buttons = Array.isArray(telegram.buttons)
    ? telegram.buttons
        .map((button) => {
          if (!button || typeof button !== "object") return null;
          const row = button as { text?: unknown; url?: unknown };
          const text = typeof row.text === "string" ? row.text.trim() : "";
          const url = typeof row.url === "string" ? row.url.trim() : "";
          return text && /^https?:\/\//iu.test(url) ? { text, url } : null;
        })
        .filter((button): button is { text: string; url: string } => Boolean(button))
    : [];
  return {
    disable_web_page_preview: typeof telegram.disableWebPagePreview === "boolean" ? telegram.disableWebPagePreview : true,
    ...(buttons.length ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
  };
}

async function sendTelegramMethod(
  method: "sendMessage" | "sendPhoto" | "sendDocument",
  params: TelegramSendBaseParams,
  body: Record<string, unknown>,
  fallbackError: string
): Promise<TelegramSendResult> {
  const canSend = await assertCanSend(params);
  if (!canSend.ok) return canSend;
  if (!("externalChatId" in canSend)) return canSend;
  const settings = await getTelegramStoredSettings();
  if (settings.dryRun) {
    return { ok: true, status: "skipped", channelMessageId: `telegram-dry-run-${params.outbox?.id ?? Date.now()}`, raw: { dryRun: true } };
  }
  const result = await telegramApiRequest<{ message_id?: number }>(method, {
    chat_id: normalizeExternalChatId(canSend.externalChatId),
    ...body,
  });
  if (!result.ok) {
    if (isTelegramChatClosed(result)) {
      await markConnectionInactive(canSend.externalChatId, result.description ?? fallbackError);
    }
    return telegramFailure(result, fallbackError);
  }
  return { ok: true, status: "sent", channelMessageId: result.result.message_id ? String(result.result.message_id) : undefined };
}

function displayName(user?: TelegramUser, chat?: TelegramChat) {
  const parts = [user?.first_name ?? chat?.first_name, user?.last_name ?? chat?.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  if (user?.username) return `@${user.username}`;
  if (chat?.username) return `@${chat.username}`;
  if (chat?.title) return chat.title;
  return chat?.id ? `Telegram ${chat.id}` : "Telegram клиент";
}

function pickMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.callback_query?.message ?? null;
}

export function normalizeIncomingMessage(update: TelegramUpdate): IncomingMessageEvent | null {
  const message = pickMessage(update);
  if (!message?.chat?.id) return null;
  const text = message.text ?? message.caption ?? update.callback_query?.data ?? "";
  if (!text.trim()) return null;
  const chatId = String(message.chat.id);
  const messageId = message.message_id ? String(message.message_id) : undefined;
  const user = update.callback_query?.from ?? message.from;
  return {
    channel: "telegram",
    externalEventId: update.update_id ? String(update.update_id) : `telegram:${chatId}:${messageId ?? Date.now()}`,
    eventType: update.edited_message ? "edited_message" : update.callback_query ? "callback_query" : "message",
    externalConversationId: `telegram:${chatId}`,
    channelMessageId: messageId,
    externalUserId: user?.id ? String(user.id) : undefined,
    externalUsername: user?.username ?? message.chat.username,
    firstName: user?.first_name ?? message.chat.first_name,
    lastName: user?.last_name ?? message.chat.last_name,
    participantName: displayName(user, message.chat),
    text,
    createdAt: message.date ? new Date(message.date * 1000) : new Date(),
    raw: update as Record<string, unknown>,
  };
}

export function parseWebhookUpdate(payload: unknown): IncomingMessageEvent | null {
  if (!payload || typeof payload !== "object") return null;
  return normalizeIncomingMessage(payload as TelegramUpdate);
}

function envConnectionStatus(): MessengerConnection["connectionStatus"] {
  if (!envTelegramEnabled()) return "disabled";
  if (envTelegramDryRun()) return "dry_run";
  if (!envBotToken()) return "not_connected";
  return "connected";
}

const defaultAllowedUpdates = ["message", "edited_message", "channel_post", "callback_query", "my_chat_member"];

export async function getTelegramRuntimeConfig() {
  return publicTelegramSettings(await getTelegramStoredSettings());
}

async function validateTelegramBotConfig() {
  const config = await getTelegramRuntimeConfig();
  if (!config.enabled) return { ok: false as const, status: "disabled" as const, error: "TELEGRAM_ENABLED is not true", details: config };
  if (!config.configured) return { ok: false as const, status: "not_connected" as const, error: "TELEGRAM_BOT_TOKEN is not configured", details: config };
  return { ok: true as const, status: config.connectionStatus, details: config };
}

export async function assertTelegramWebhookSecret(headers?: Headers) {
  const settings = await getTelegramStoredSettings();
  const expectedSecret = settings.webhookSecret?.trim();
  if (!expectedSecret) return;
  const actual = headers?.get("x-telegram-bot-api-secret-token")?.trim();
  if (actual !== expectedSecret) throw new Error("Invalid Telegram webhook secret");
}

export async function setTelegramWebhook(options: { dropPendingUpdates?: boolean } = {}) {
  const settings = await getTelegramStoredSettings();
  const url = settings.webhookUrl ?? "";
  if (!url) return { ok: false as const, error: "TELEGRAM_WEBHOOK_URL is not configured" };
  if (settings.dryRun) return { ok: true as const, dryRun: true, webhookUrl: url };
  const result = await telegramApiRequest<boolean>("setWebhook", {
    url,
    secret_token: settings.webhookSecret?.trim() || undefined,
    allowed_updates: defaultAllowedUpdates,
    drop_pending_updates: options.dropPendingUpdates ?? false,
  });
  return result.ok
    ? { ok: true as const, webhookUrl: url }
    : { ok: false as const, error: result.description ?? "Telegram setWebhook failed", errorCode: result.error_code };
}

export async function setWebhook(options: { dropPendingUpdates?: boolean } = {}) {
  return setTelegramWebhook(options);
}

export async function deleteTelegramWebhook(options: { dropPendingUpdates?: boolean } = {}) {
  const settings = await getTelegramStoredSettings();
  if (settings.dryRun) return { ok: true as const, dryRun: true };
  const result = await telegramApiRequest<boolean>("deleteWebhook", {
    drop_pending_updates: options.dropPendingUpdates ?? false,
  });
  return result.ok
    ? { ok: true as const }
    : { ok: false as const, error: result.description ?? "Telegram deleteWebhook failed", errorCode: result.error_code };
}

export async function deleteWebhook(options: { dropPendingUpdates?: boolean } = {}) {
  return deleteTelegramWebhook(options);
}

export async function getTelegramWebhookInfo() {
  const settings = await getTelegramStoredSettings();
  const config = publicTelegramSettings(settings);
  if (settings.dryRun) return { ok: true as const, dryRun: true, info: null, config };
  const result = await telegramApiRequest<TelegramWebhookInfo>("getWebhookInfo");
  return result.ok
    ? { ok: true as const, info: result.result, config }
    : { ok: false as const, error: result.description ?? "Telegram getWebhookInfo failed", errorCode: result.error_code, config };
}

export async function getWebhookInfo() {
  return getTelegramWebhookInfo();
}

export async function getTelegramUpdates(input: { offset?: number; limit?: number; timeout?: number } = {}) {
  const settings = await getTelegramStoredSettings();
  if (settings.dryRun) return { ok: true as const, dryRun: true, updates: [] as TelegramUpdate[] };
  const result = await telegramApiRequest<TelegramUpdate[]>("getUpdates", {
    offset: input.offset,
    limit: input.limit ?? 20,
    timeout: input.timeout ?? 0,
    allowed_updates: defaultAllowedUpdates,
  });
  return result.ok
    ? { ok: true as const, updates: result.result }
    : { ok: false as const, error: result.description ?? "Telegram getUpdates failed", errorCode: result.error_code };
}

function renderTemplate(templateText: string, variables: TelegramSendTemplateParams["variables"] = {}) {
  return templateText.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export async function sendTextMessage(params: TelegramSendTextParams): Promise<TelegramSendResult> {
  return sendTelegramMethod(
    "sendMessage",
    params,
    {
      text: params.text,
      ...telegramOptionsFromOutbox(params.outbox),
    },
    "Telegram sendMessage failed"
  );
}

export async function sendPhotoMessage(params: TelegramSendPhotoParams): Promise<TelegramSendResult> {
  return sendTelegramMethod(
    "sendPhoto",
    params,
    {
      photo: params.photoUrl,
      caption: params.caption ?? params.text,
    },
    "Telegram sendPhoto failed"
  );
}

export async function sendDocumentMessage(params: TelegramSendDocumentParams): Promise<TelegramSendResult> {
  return sendTelegramMethod(
    "sendDocument",
    params,
    {
      document: params.documentUrl,
      caption: params.caption ?? params.text,
      filename: params.fileName,
    },
    "Telegram sendDocument failed"
  );
}

export async function sendTemplateMessage(params: TelegramSendTemplateParams): Promise<TelegramSendResult> {
  return sendTextMessage({
    ...params,
    text: renderTemplate(params.templateText, params.variables),
  });
}

export const telegramChannelAdapter: MessengerChannelAdapter = {
  channel: "telegram",
  getConnection(): MessengerConnection {
    return {
      id: "conn-telegram-default",
      channel: "telegram",
      type: "unknown",
      externalChatId: "telegram:default",
      displayName: "Telegram Bot",
      externalUsername: envBotUsername() || null,
      isActive: envConnectionStatus() === "connected" || envConnectionStatus() === "dry_run",
      rawJson: {
        webhookUrl: envWebhookUrl() || null,
        dryRun: envTelegramDryRun(),
        enabled: envTelegramEnabled(),
        botUsername: envBotUsername() || null,
      },
      connectionStatus: envConnectionStatus(),
      label: "Telegram",
      config: {
        webhookUrl: envWebhookUrl() || null,
        dryRun: envTelegramDryRun(),
        enabled: envTelegramEnabled(),
        botUsername: envBotUsername() || null,
      },
    };
  },
  async sendMessage(outbox: MessageOutbox) {
    return sendTextMessage({ outbox, text: outbox.text });
  },
  async sendText(outbox: MessageOutbox) {
    return sendTextMessage({ outbox, text: outbox.text });
  },
  async parseWebhook(payload: unknown, headers?: Headers): Promise<IncomingMessageEvent[]> {
    if (headers) await assertTelegramWebhookSecret(headers);
    const event = parseWebhookUpdate(payload);
    return event ? [event] : [];
  },
  async setWebhook() {
    const result = await setTelegramWebhook();
    return result.ok ? { ok: true, dryRun: "dryRun" in result ? Boolean(result.dryRun) : false, raw: result } : { ok: false, error: result.error, raw: result };
  },
  async getWebhookInfo() {
    const result = await getTelegramWebhookInfo();
    return result.ok ? { ok: true, dryRun: "dryRun" in result ? Boolean(result.dryRun) : false, raw: result } : { ok: false, error: result.error, raw: result };
  },
  async validateConfig() {
    return validateTelegramBotConfig();
  },
  validatePlatformConfig() {
    return validateTelegramBotConfig();
  },
  async startOnboarding() {
    return { ok: false, status: "legacy_hidden", error: "Bot-only Telegram скрыт из основного сценария. Используйте User Session." };
  },
  async completeOnboarding() {
    return { ok: false, status: "legacy_hidden", error: "Bot-only Telegram скрыт из основного сценария." };
  },
  async disconnect() {
    return { ok: true, status: "legacy_hidden" };
  },
  async reconnect() {
    return { ok: false, status: "legacy_hidden", error: "Используйте Telegram User Session." };
  },
  async testConnection() {
    return validateTelegramBotConfig();
  },
  async syncConversations() {
    return { ok: false, error: "Telegram Bot legacy sync is disabled" };
  },
  async syncMessages() {
    return { ok: false, error: "Telegram Bot legacy sync is disabled" };
  },
  async processWebhook(payload, headers) {
    if (headers) await assertTelegramWebhookSecret(headers);
    const event = parseWebhookUpdate(payload);
    const events = event ? [event] : [];
    return { ok: true, raw: { events: events?.length ?? 0 } };
  },
  getCapabilities() {
    return {
      channel: "telegram",
      allowedMode: "Legacy Bot API (hidden)",
      inbound: "Unsupported",
      outbound: "Unsupported",
      realtime: "Unsupported",
      access: "Unsupported",
      summary: "Bot-only режим не используется в основном Telegram-сценарии.",
    };
  },
};
