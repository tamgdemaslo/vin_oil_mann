import type { MessengerChannel, MessengerConnection } from "../messenger-types";
import type { ChannelConfigValidationResult, ChannelSendResult, MessengerChannelAdapter } from "./types";

type PlannedChannelConfig = {
  channel: Exclude<MessengerChannel, "telegram" | "mock">;
  label: string;
  transportNote: string;
  envKeys?: string[];
};

const plannedConfigs: PlannedChannelConfig[] = [
  {
    channel: "whatsapp",
    label: "WhatsApp",
    transportNote: "Planned: WhatsApp Business Platform Cloud API / Meta Graph API with message webhooks.",
    envKeys: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WEBHOOK_SECRET"],
  },
  {
    channel: "instagram",
    label: "Instagram",
    transportNote: "Planned: Instagram Messaging via Meta Graph infrastructure and webhooks.",
    envKeys: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_PAGE_ID", "INSTAGRAM_WEBHOOK_SECRET"],
  },
  {
    channel: "vk",
    label: "VK",
    transportNote: "Planned: VK Messages API adapter with webhook/callback normalization.",
    envKeys: ["VK_GROUP_TOKEN", "VK_CONFIRMATION_TOKEN", "VK_SECRET"],
  },
  {
    channel: "max",
    label: "MAX",
    transportNote: "Planned: MAX Bot API via platform-api.max.ru. Token must be sent in the Authorization header, not as a query parameter.",
    envKeys: ["MAX_BOT_TOKEN", "MAX_WEBHOOK_SECRET"],
  },
  {
    channel: "avito",
    label: "Avito",
    transportNote: "Planned: Avito messenger adapter with normalized conversations and webhook events.",
  },
  {
    channel: "website",
    label: "Сайт",
    transportNote: "Planned: website chat widget adapter backed by Messenger Gateway webhooks/SSE.",
  },
  {
    channel: "sms",
    label: "SMS",
    transportNote: "Planned: SMS provider adapter with delivery status callbacks.",
  },
  {
    channel: "email",
    label: "Email",
    transportNote: "Planned: email adapter with inbound mailbox/webhook parsing and outbound SMTP/API delivery.",
  },
];

function plannedConnection(config: PlannedChannelConfig): MessengerConnection {
  return {
    id: `conn-${config.channel}-planned`,
    channel: config.channel,
    type: "unknown",
    externalChatId: `${config.channel}:planned`,
    displayName: config.label,
    isActive: false,
    connectionStatus: "disabled",
    label: config.label,
    rawJson: {
      adapterStatus: "planned",
      transportNote: config.transportNote,
      envKeys: config.envKeys ?? [],
    },
    config: {
      adapterStatus: "planned",
      transportNote: config.transportNote,
      envKeys: config.envKeys ?? [],
    },
  };
}

function plannedSendResult(config: PlannedChannelConfig): ChannelSendResult {
  return {
    ok: false,
    error: `${config.label} adapter is planned and not enabled yet`,
    raw: {
      adapterStatus: "planned",
      channel: config.channel,
      transportNote: config.transportNote,
    },
  };
}

function plannedValidation(config: PlannedChannelConfig): ChannelConfigValidationResult {
  return {
    ok: false,
    status: "disabled",
    error: `${config.label} adapter is planned`,
    details: {
      adapterStatus: "planned",
      channel: config.channel,
      transportNote: config.transportNote,
      envKeys: config.envKeys ?? [],
    },
  };
}

function createPlannedAdapter(config: PlannedChannelConfig): MessengerChannelAdapter {
  return {
    channel: config.channel,
    getConnection() {
      return plannedConnection(config);
    },
    async sendMessage() {
      return plannedSendResult(config);
    },
    async parseWebhook() {
      return [];
    },
    async setWebhook() {
      return { ok: false, error: `${config.label} webhook is planned`, raw: { transportNote: config.transportNote } };
    },
    async getWebhookInfo() {
      return { ok: false, error: `${config.label} webhook is planned`, raw: { transportNote: config.transportNote } };
    },
    validateConfig() {
      return plannedValidation(config);
    },
    validatePlatformConfig() {
      return plannedValidation(config);
    },
    async startOnboarding() {
      return {
        ok: false,
        status: "awaiting_audit",
        error: `${config.label} будет доступен после утверждения capability audit`,
        details: { transportNote: config.transportNote, envKeys: config.envKeys ?? [] },
      };
    },
    async completeOnboarding() {
      return { ok: false, status: "planned", error: `${config.label} adapter is planned` };
    },
    async disconnect() {
      return { ok: true, status: "planned", details: { channel: config.channel } };
    },
    async reconnect() {
      return { ok: false, status: "planned", error: `${config.label} adapter is planned` };
    },
    async testConnection() {
      return plannedValidation(config);
    },
    async syncConversations() {
      return { ok: false, error: `${config.label} sync is planned` };
    },
    async syncMessages() {
      return { ok: false, error: `${config.label} sync is planned` };
    },
    async processWebhook() {
      return { ok: false, error: `${config.label} webhook is planned`, raw: { transportNote: config.transportNote } };
    },
    getCapabilities() {
      return {
        channel: config.channel,
        allowedMode: config.transportNote,
        inbound: "Requires approval",
        outbound: "Requires approval",
        realtime: "Requires approval",
        access: "Requires approval",
        summary: config.transportNote,
      };
    },
  };
}

export const plannedChannelAdapters = Object.fromEntries(
  plannedConfigs.map((config) => [config.channel, createPlannedAdapter(config)])
) as Record<PlannedChannelConfig["channel"], MessengerChannelAdapter>;
