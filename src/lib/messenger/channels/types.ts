import type {
  IncomingMessageEvent,
  IntegrationOnboardingSession,
  MessengerAccount,
  MessengerChannel,
  MessengerChannelCapabilities,
  MessengerConnection,
  MessageOutbox,
} from "../messenger-types";

export type ChannelSendResult =
  | { ok: true; channelMessageId?: string; status?: "sent" | "skipped"; raw?: Record<string, unknown> }
  | { ok: false; error: string; raw?: Record<string, unknown> };

export type ChannelConfigValidationResult =
  | { ok: true; status?: MessengerConnection["connectionStatus"]; details?: Record<string, unknown> }
  | { ok: false; error: string; status?: MessengerConnection["connectionStatus"]; details?: Record<string, unknown> };

export type ChannelWebhookResult =
  | { ok: true; dryRun?: boolean; raw?: Record<string, unknown> }
  | { ok: false; error: string; raw?: Record<string, unknown> };

export type ChannelOnboardingResult =
  | {
      ok: true;
      session?: IntegrationOnboardingSession;
      account?: MessengerAccount;
      status?: string;
      nextStep?: string;
      details?: Record<string, unknown>;
    }
  | { ok: false; error: string; status?: string; details?: Record<string, unknown> };

export type ChannelSyncResult =
  | { ok: true; accountId?: string; conversationCount?: number; messageCount?: number; details?: Record<string, unknown> }
  | { ok: false; accountId?: string; error: string; details?: Record<string, unknown> };

export type MessengerChannelAdapter = {
  channel: MessengerChannel;
  getConnection(): MessengerConnection;
  sendMessage(input: MessageOutbox): Promise<ChannelSendResult>;
  sendText?(outbox: MessageOutbox): Promise<ChannelSendResult>;
  parseWebhook?(payload: unknown, headers?: Headers): Promise<IncomingMessageEvent[]>;
  setWebhook?(): Promise<ChannelWebhookResult>;
  getWebhookInfo?(): Promise<ChannelWebhookResult>;
  validateConfig?(): ChannelConfigValidationResult | Promise<ChannelConfigValidationResult>;
  validatePlatformConfig?(input?: Record<string, unknown>): ChannelConfigValidationResult | Promise<ChannelConfigValidationResult>;
  startOnboarding?(input?: Record<string, unknown>): Promise<ChannelOnboardingResult>;
  completeOnboarding?(input?: Record<string, unknown>): Promise<ChannelOnboardingResult>;
  disconnect?(input?: { accountId?: string }): Promise<ChannelOnboardingResult>;
  reconnect?(input?: { accountId?: string }): Promise<ChannelOnboardingResult>;
  testConnection?(input?: { accountId?: string }): Promise<ChannelConfigValidationResult>;
  syncConversations?(input?: { accountId?: string; limit?: number }): Promise<ChannelSyncResult>;
  syncMessages?(input?: { accountId?: string; conversationId?: string; limit?: number }): Promise<ChannelSyncResult>;
  markAsRead?(input: { accountId?: string; conversationId: string }): Promise<{ ok: boolean; error?: string }>;
  processWebhook?(payload: unknown, headers?: Headers): Promise<ChannelWebhookResult>;
  getCapabilities?(): MessengerChannelCapabilities;
};
