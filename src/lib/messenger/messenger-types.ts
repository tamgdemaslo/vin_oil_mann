export type MessengerChannel =
  | "telegram"
  | "whatsapp"
  | "vk"
  | "instagram"
  | "avito"
  | "max"
  | "website"
  | "sms"
  | "email"
  | "mock";

export type MessengerConnectionStatus = "connected" | "not_connected" | "error" | "dry_run" | "disabled";
export type MessengerAdapterStatus = "real" | "test" | "planned";
export type MessengerAccountMode = "user_session" | "bot_legacy";
export type MessengerAccountStatus =
  | "disconnected"
  | "waiting_code"
  | "waiting_qr"
  | "waiting_password"
  | "connected"
  | "needs_auth"
  | "error"
  | "disabled"
  | "degraded"
  | "reconnect_required"
  | "awaiting_action";
export type ConversationStatus = "open" | "needs_reply" | "waiting" | "closed" | "archived" | "blocked";
export type MessageDirection = "inbound" | "outbound" | "system";
export type MessageAuthorType = "client" | "employee" | "bot" | "system";
export type MessageStatus = "received" | "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped";
export type AttachmentType =
  | "photo"
  | "image"
  | "video"
  | "voice"
  | "audio"
  | "document"
  | "file"
  | "sticker"
  | "animation"
  | "video_note"
  | "link"
  | "location"
  | "contact"
  | "unsupported";
export type ConversationKind = "client" | "supplier" | "employee" | "unknown";
export type MessengerParticipantType = "client" | "employee" | "supplier" | "unknown";
export type OutboxStatus = "queued" | "processing" | "sent" | "failed" | "skipped";
export type MessageType = "text" | "image" | "file" | "report" | "template" | "system";
export type WebhookEventStatus = "received" | "processed" | "duplicate" | "failed";
export type MessengerRealtimeEventType =
  | "conversation.created"
  | "conversation.updated"
  | "message.created"
  | "message.status_updated"
  | "unread.updated";

export type MessengerConnection = {
  id: string;
  organizationId?: string;
  channel: MessengerChannel;
  type: MessengerParticipantType;
  clientId?: string | null;
  employeeId?: string | null;
  supplierId?: string | null;
  externalUserId?: string | null;
  externalChatId: string;
  externalUsername?: string | null;
  displayName: string;
  phone?: string | null;
  avatarUrl?: string | null;
  isActive: boolean;
  linkedAt?: string | null;
  lastSeenAt?: string | null;
  blockedAt?: string | null;
  rawJson?: Record<string, unknown> | null;
  connectionStatus: MessengerConnectionStatus;
  label?: string;
  config?: Record<string, unknown> | null;
  lastError?: string | null;
};

export type MessengerChannelDefinition = {
  key: MessengerChannel;
  label: string;
  icon: string;
  color: string;
  enabled: boolean;
  connectionStatus: MessengerConnectionStatus;
  adapterStatus: MessengerAdapterStatus;
  connection?: MessengerConnection;
  capabilityStatus?: "Supported" | "Partially supported" | "Requires approval" | "Unsupported";
  capabilitySummary?: string;
  allowedMode?: string;
  docsUrl?: string;
};

export type MessengerAccount = {
  id: string;
  organizationId?: string;
  channel: MessengerChannel;
  mode: MessengerAccountMode;
  externalAccountId?: string | null;
  displayName: string;
  phone?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  isActive: boolean;
  isDefault?: boolean;
  enabled?: boolean;
  status: MessengerAccountStatus;
  connectedByUserId?: string | null;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  lastSyncAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadataJson?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  conversationCount?: number;
};

export const messengerChannels: MessengerChannel[] = [
  "telegram",
  "whatsapp",
  "vk",
  "instagram",
  "avito",
  "max",
  "website",
  "sms",
  "email",
  "mock",
];

export const messengerChannelCatalog: Record<
  MessengerChannel,
  Pick<MessengerChannelDefinition, "key" | "label" | "icon" | "color">
> = {
  telegram: { key: "telegram", label: "Telegram", icon: "send", color: "#229ed9" },
  whatsapp: { key: "whatsapp", label: "WhatsApp", icon: "phone", color: "#128c7e" },
  vk: { key: "vk", label: "VK", icon: "at-sign", color: "#0077ff" },
  instagram: { key: "instagram", label: "Instagram", icon: "at-sign", color: "#d62976" },
  avito: { key: "avito", label: "Avito", icon: "message-circle", color: "#00aaff" },
  max: { key: "max", label: "Max", icon: "messages-square", color: "#3b5bdb" },
  website: { key: "website", label: "Сайт", icon: "globe-2", color: "#15803d" },
  sms: { key: "sms", label: "SMS", icon: "smartphone", color: "#b45309" },
  email: { key: "email", label: "Email", icon: "mail", color: "#525252" },
  mock: { key: "mock", label: "Mock", icon: "messages-square", color: "#737373" },
};

export type Attachment = {
  id: string;
  type: AttachmentType;
  url?: string;
  name?: string;
  size?: number;
  previewUrl?: string;
  mimeType?: string;
  status?: "pending" | "queued" | "downloading" | "available" | "ready" | "failed" | "too_large" | "unsupported";
  progress?: number;
  caption?: string;
  width?: number;
  height?: number;
  duration?: number;
  errorCode?: string;
  errorMessage?: string;
  metadataJson?: Record<string, unknown>;
};

export type Conversation = {
  id: string;
  organizationId?: string;
  messengerAccountId?: string | null;
  channel: MessengerChannel;
  externalConversationId: string;
  title: string;
  participantName: string;
  participantPhone?: string;
  participantAvatar?: string;
  lastMessageText: string;
  lastMessageAt: string;
  unreadCount: number;
  isPinned: boolean;
  isImportant: boolean;
  status: ConversationStatus;
  kind: ConversationKind;
  clientId?: string;
  vehicleId?: string;
  appointmentId?: string;
  shipmentId?: string;
  caseId?: string;
  diagnosticId?: string;
  taskId?: string;
  assignedTo?: string;
  tags: string[];
  hasOverdueCase?: boolean;
};

export type Message = {
  id: string;
  organizationId?: string;
  conversationId: string;
  messengerAccountId?: string | null;
  channel: MessengerChannel;
  direction: MessageDirection;
  authorName: string;
  authorType: MessageAuthorType;
  text: string;
  attachments: Attachment[];
  createdAt: string;
  status: MessageStatus;
  channelMessageId?: string;
  replyToId?: string;
};

export type MessageTemplate = {
  id: string;
  key: string;
  title: string;
  channel?: MessengerChannel | null;
  text: string;
  variablesJson: string[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type MessageOutbox = {
  id: string;
  organizationId?: string;
  messengerAccountId?: string | null;
  channel: MessengerChannel;
  conversationId?: string | null;
  messageId?: string | null;
  connectionId?: string | null;
  recipientExternalChatId: string;
  messageType: MessageType;
  text: string;
  attachmentsJson: Attachment[];
  templateKey?: string | null;
  templateVarsJson?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  status: OutboxStatus;
  attempts: number;
  lastAttemptAt?: string | null;
  nextAttemptAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type WebhookEvent = {
  id: string;
  organizationId?: string;
  channel: MessengerChannel;
  externalUpdateId: string;
  rawJson: Record<string, unknown>;
  status: WebhookEventStatus;
  error?: string | null;
  processedAt?: string | null;
  createdAt: string;
};

export type MessengerLinkToken = {
  id: string;
  organizationId?: string;
  token: string;
  channel: MessengerChannel;
  type: "client" | "employee";
  clientId?: string | null;
  employeeId?: string | null;
  expiresAt: string;
  usedAt?: string | null;
  createdById?: string | null;
  createdAt: string;
};

export type IncomingMessageEvent = {
  channel: MessengerChannel;
  externalEventId: string;
  eventType: string;
  externalConversationId: string;
  channelMessageId?: string;
  externalUserId?: string;
  externalUsername?: string;
  firstName?: string;
  lastName?: string;
  participantName: string;
  participantAvatar?: string;
  text: string;
  createdAt: Date;
  raw: Record<string, unknown>;
};

export type SendMessageInput = {
  conversationId: string;
  text: string;
  createdByLogin?: string;
  replyToId?: string;
};

export type SendMessageResult = {
  ok: boolean;
  message: Message;
  outbox?: MessageOutbox;
  error?: string;
};

export type MessengerCapabilityStatus = "Supported" | "Partially supported" | "Requires approval" | "Unsupported";

export type MessengerChannelCapabilities = {
  channel: MessengerChannel;
  allowedMode: string;
  inbound: MessengerCapabilityStatus;
  outbound: MessengerCapabilityStatus;
  realtime: MessengerCapabilityStatus;
  access: MessengerCapabilityStatus;
  summary: string;
  docsUrl?: string;
};

export type IntegrationChannelCard = MessengerChannelDefinition & {
  account?: MessengerAccount | null;
  onboardingMode: "active" | "coming_soon" | "audit_required";
  healthStatus: "connected" | "disabled" | "planned" | "error" | "needs_auth";
  primaryAction: "configure" | "connect" | "coming_soon" | "reconnect";
};

export type IntegrationOnboardingSession = {
  id: string;
  organizationId: string;
  channel: MessengerChannel;
  providerKey?: string | null;
  messengerAccountId?: string | null;
  status: string;
  currentStep: string;
  dataJson: Record<string, unknown>;
  errorMessage?: string | null;
  expiresAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MessengerRealtimeEvent = {
  id: string;
  type: MessengerRealtimeEventType;
  createdAt: string;
  conversationId?: string;
  messageId?: string;
  unreadTotal?: number;
  payload?: Conversation | Message | { unreadTotal: number };
};

export type MessengerListParams = {
  search?: string;
  filter?: "all" | "unread" | "important" | "clients" | "suppliers" | "employees" | "withoutClient" | "openCases";
  channel?: MessengerChannel | "all";
  clientId?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
};
