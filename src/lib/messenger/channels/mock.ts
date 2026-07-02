import type { Conversation, IncomingMessageEvent, Message, MessengerConnection } from "../messenger-types";
import type { MessengerChannelAdapter } from "./types";

export const mockMessengerConnection: MessengerConnection = {
  id: "conn-mock-default",
  channel: "mock",
  type: "unknown",
  externalChatId: "mock:default",
  displayName: "Mock Gateway",
  isActive: true,
  rawJson: { mode: "local" },
  connectionStatus: "dry_run",
  label: "Mock Gateway",
  config: { mode: "local" },
};

export const mockGatewayConversations: Conversation[] = [
  {
    id: "mock-telegram-soloviev",
    channel: "telegram",
    externalConversationId: "tg:mock-soloviev",
    title: "BMW X5 · Telegram",
    participantName: "Алексей Соловьёв",
    participantPhone: "+7 911 487 22 14",
    lastMessageText: "Подтверждаю запись на 14:30, подъеду за 10 минут.",
    lastMessageAt: new Date("2026-06-16T13:42:00+02:00").toISOString(),
    unreadCount: 2,
    isPinned: true,
    isImportant: true,
    status: "needs_reply",
    kind: "client",
    clientId: "c-247",
    vehicleId: "v-bmw-x5",
    appointmentId: "A-465",
    shipmentId: "TGM-2026-0438",
    caseId: "D-2026-0066",
    taskId: "T-118",
    assignedTo: "Сергей Игнатенко",
    tags: ["BMW", "запись", "предчек"],
  },
  {
    id: "mock-whatsapp-q7",
    channel: "whatsapp",
    externalConversationId: "wa:mock-q7",
    title: "Audi Q7 · WhatsApp",
    participantName: "Игорь Михайлов",
    participantPhone: "+7 911 384 12 56",
    lastMessageText: "Если успеете сегодня, согласую промывку и фильтр.",
    lastMessageAt: new Date("2026-06-16T12:58:00+02:00").toISOString(),
    unreadCount: 1,
    isPinned: false,
    isImportant: true,
    status: "needs_reply",
    kind: "client",
    clientId: "c-318",
    vehicleId: "v-audi-q7",
    appointmentId: "A-461",
    shipmentId: "TGM-2026-0437",
    caseId: "D-2026-0068",
    taskId: "T-121",
    assignedTo: "Анна Лебедева",
    tags: ["ATF", "согласование", "просрочка"],
    hasOverdueCase: true,
  },
  {
    id: "mock-avito-lead",
    channel: "avito",
    externalConversationId: "avito:mock-lead",
    title: "Подбор масла по VIN",
    participantName: "Клиент Avito",
    participantPhone: "+7 911 000 44 88",
    lastMessageText: "Здравствуйте, нужна цена масла и фильтра по VIN.",
    lastMessageAt: new Date("2026-06-16T10:05:00+02:00").toISOString(),
    unreadCount: 0,
    isPinned: false,
    isImportant: false,
    status: "open",
    kind: "unknown",
    assignedTo: "Анна Лебедева",
    tags: ["без клиента", "VIN"],
  },
];

export const mockGatewayMessages: Record<string, Message[]> = {
  "mock-telegram-soloviev": [
    {
      id: "mock-m-tg-1",
      conversationId: "mock-telegram-soloviev",
      channel: "telegram",
      direction: "system",
      authorName: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
      authorType: "system",
      text: "Mock conversation. Реальные Telegram webhook-сообщения появятся здесь после подключения бота.",
      attachments: [],
      createdAt: new Date("2026-06-16T09:10:00+02:00").toISOString(),
      status: "read",
    },
    {
      id: "mock-m-tg-2",
      conversationId: "mock-telegram-soloviev",
      channel: "telegram",
      direction: "inbound",
      authorName: "Алексей Соловьёв",
      authorType: "client",
      text: "Подтверждаю запись на 14:30, подъеду за 10 минут.",
      attachments: [],
      createdAt: new Date("2026-06-16T13:42:00+02:00").toISOString(),
      status: "delivered",
      channelMessageId: "mock-tg-103",
    },
  ],
};

export const mockChannelAdapter: MessengerChannelAdapter = {
  channel: "mock",
  getConnection() {
    return mockMessengerConnection;
  },
  async sendMessage() {
    return { ok: true, channelMessageId: `mock-${Date.now()}`, raw: { dryRun: true } };
  },
  async sendText() {
    return { ok: true, channelMessageId: `mock-${Date.now()}`, raw: { dryRun: true } };
  },
  validateConfig() {
    return { ok: true, status: "dry_run", details: { adapterStatus: "test" } };
  },
  validatePlatformConfig() {
    return { ok: true, status: "dry_run", details: { adapterStatus: "test" } };
  },
  async startOnboarding() {
    return { ok: true, status: "mock", details: { adapterStatus: "test" } };
  },
  async completeOnboarding() {
    return { ok: true, status: "mock", details: { adapterStatus: "test" } };
  },
  async disconnect() {
    return { ok: true, status: "mock" };
  },
  async reconnect() {
    return { ok: true, status: "mock" };
  },
  async testConnection() {
    return { ok: true, status: "dry_run", details: { adapterStatus: "test" } };
  },
  async syncConversations() {
    return { ok: true, conversationCount: mockGatewayConversations.length, messageCount: Object.values(mockGatewayMessages).flat().length };
  },
  async syncMessages() {
    return { ok: true, messageCount: Object.values(mockGatewayMessages).flat().length };
  },
  getCapabilities() {
    return {
      channel: "mock",
      allowedMode: "Dev mock adapter",
      inbound: "Supported",
      outbound: "Supported",
      realtime: "Partially supported",
      access: "Supported",
      summary: "Локальный тестовый adapter без внешней интеграции.",
    };
  },
};

export function createMockIncomingEvent(): IncomingMessageEvent {
  return {
    channel: "mock",
    externalEventId: `mock-event-${Date.now()}`,
    eventType: "message",
    externalConversationId: "mock:incoming",
    channelMessageId: `mock-message-${Date.now()}`,
    participantName: "Mock клиент",
    text: "Новое mock-сообщение через Messenger Gateway.",
    createdAt: new Date(),
    raw: { source: "dev-simulation" },
  };
}
