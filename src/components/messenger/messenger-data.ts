import type { ReactNode } from "react";
import {
  AtSign,
  Globe2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Phone,
  Send,
  Smartphone,
} from "lucide-react";

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

export type ChannelConnectionStatus = "connected" | "not_connected" | "error" | "dry_run" | "disabled";
export type ChannelAdapterStatus = "real" | "test" | "planned";
export type ConversationStatus = "open" | "needs_reply" | "waiting" | "closed" | "archived" | "blocked";
export type MessageDirection = "inbound" | "outbound" | "system";
export type MessageAuthorType = "client" | "employee" | "bot" | "system";
export type MessageStatus = "received" | "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped";
export type AttachmentType =
  | "image"
  | "video"
  | "file"
  | "voice"
  | "link"
  | "audio"
  | "document"
  | "location"
  | "contact"
  | "unsupported";
export type ConversationKind = "client" | "supplier" | "employee" | "unknown";

export type Attachment = {
  id: string;
  type: AttachmentType;
  url?: string;
  name?: string;
  size?: number;
  previewUrl?: string;
  mimeType?: string;
  status?: "pending" | "queued" | "downloading" | "available" | "ready" | "failed" | "too_large" | "unsupported";
  caption?: string;
  width?: number;
  height?: number;
  duration?: number;
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
  channel?: MessengerChannel;
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

export type QuickReplyTemplate = {
  id: string;
  key: string;
  title: string;
  text: string;
  variablesJson: string[];
};

export type MessengerClientContext = {
  id: string;
  name: string;
  phone: string;
  type: "Физлицо" | "Юрлицо" | "Поставщик";
  telegramUsername?: string | null;
  vehicle?: {
    id: string;
    label: string;
    plate: string;
    vin: string;
    year?: string | null;
  };
  vehicles?: Array<{
    id: string;
    label: string;
    plate: string;
    vin: string;
    year?: string | null;
  }>;
  activeCase?: {
    id: string;
    title: string;
    status: string;
    responsible: string;
    deadline: string;
    overdue?: boolean;
  };
  appointment?: {
    id: string;
    date: string;
    service: string;
    status: string;
  };
  shipments: Array<{
    id: string;
    title: string;
    amount: string;
    status: string;
  }>;
  diagnostics: Array<{
    id: string;
    title: string;
    status: string;
    publicReportUrl?: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
  }>;
};

export type MessengerContextState =
  | "loading"
  | "unclassified"
  | "suggestions"
  | "unlinked"
  | "linked"
  | "conflict"
  | "archived"
  | "supplier"
  | "employee"
  | "group"
  | "forbidden"
  | "error";

export type MessengerClientSuggestion = {
  id: string;
  name: string;
  phone?: string;
  type?: MessengerClientContext["type"];
  score?: number;
  reason?: string;
  vehicle?: MessengerClientContext["vehicle"];
};

export type MessengerConversationContext = {
  state: MessengerContextState;
  reason?: string;
  conversationId: string;
  organizationId?: string;
  expectedUpdatedAt?: string;
  client: MessengerClientContext | null;
  suggestions: MessengerClientSuggestion[];
  selectedVehicle?: MessengerClientContext["vehicle"] | null;
  vehicles?: NonNullable<MessengerClientContext["vehicles"]>;
  actions?: Array<{ key: string; label: string; enabled: boolean; reason?: string; href?: string }>;
  updatedAt?: string;
};

export type ChannelConfig = {
  key: MessengerChannel;
  id: MessengerChannel;
  label: string;
  shortLabel: string;
  color: string;
  tint: string;
  enabled: boolean;
  connectionStatus: ChannelConnectionStatus;
  connectionStatusLabel: string;
  adapterStatus: ChannelAdapterStatus;
  adapterStatusLabel: string;
  Icon: (props: { className?: string; "aria-hidden"?: boolean }) => ReactNode;
};

export const channelConfigs: Record<MessengerChannel, ChannelConfig> = {
  telegram: {
    key: "telegram",
    id: "telegram",
    label: "Telegram",
    shortLabel: "TG",
    color: "#229ed9",
    tint: "#e8f6fd",
    enabled: true,
    connectionStatus: "not_connected",
    connectionStatusLabel: "не подключён",
    adapterStatus: "real",
    adapterStatusLabel: "реальный адаптер",
    Icon: Send,
  },
  whatsapp: {
    key: "whatsapp",
    id: "whatsapp",
    label: "WhatsApp",
    shortLabel: "WA",
    color: "#128c7e",
    tint: "#e3f7f1",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: Phone,
  },
  vk: {
    key: "vk",
    id: "vk",
    label: "VK",
    shortLabel: "VK",
    color: "#0077ff",
    tint: "#e8f2ff",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: AtSign,
  },
  instagram: {
    key: "instagram",
    id: "instagram",
    label: "Instagram",
    shortLabel: "IG",
    color: "#d62976",
    tint: "#fde8f2",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: AtSign,
  },
  avito: {
    key: "avito",
    id: "avito",
    label: "Avito",
    shortLabel: "AV",
    color: "#00aaff",
    tint: "#e7f7ff",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: MessageCircle,
  },
  max: {
    key: "max",
    id: "max",
    label: "Max",
    shortLabel: "MX",
    color: "#3b5bdb",
    tint: "#eef2ff",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: MessagesSquare,
  },
  website: {
    key: "website",
    id: "website",
    label: "Сайт",
    shortLabel: "WEB",
    color: "#15803d",
    tint: "#dcfce7",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: Globe2,
  },
  sms: {
    key: "sms",
    id: "sms",
    label: "SMS",
    shortLabel: "SMS",
    color: "#b45309",
    tint: "#fef3c7",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: Smartphone,
  },
  email: {
    key: "email",
    id: "email",
    label: "Email",
    shortLabel: "EM",
    color: "#525252",
    tint: "#f4f1ea",
    enabled: false,
    connectionStatus: "disabled",
    connectionStatusLabel: "запланирован",
    adapterStatus: "planned",
    adapterStatusLabel: "planned",
    Icon: Mail,
  },
  mock: {
    key: "mock",
    id: "mock",
    label: "Mock",
    shortLabel: "MOCK",
    color: "#737373",
    tint: "#f4f1ea",
    enabled: true,
    connectionStatus: "dry_run",
    connectionStatusLabel: "тестовый",
    adapterStatus: "test",
    adapterStatusLabel: "тестовый адаптер",
    Icon: MessagesSquare,
  },
};

export const quickReplyTemplates: QuickReplyTemplate[] = [
  {
    id: "tpl-diagnostic-report",
    key: "diagnostic_report",
    title: "Отчёт диагностики",
    text: "Здравствуйте, {{clientName}}!\nГотов отчёт диагностики по автомобилю {{vehicleName}}.\n\n{{reportUrl}}\n\nЕсли хотите согласовать работы — напишите нам.",
    variablesJson: ["clientName", "vehicleName", "reportUrl"],
  },
  {
    id: "tpl-appointment-confirm",
    key: "appointment_confirm",
    title: "Подтверждение записи",
    text: "Здравствуйте, {{clientName}}!\nВы записаны на {{date}} в {{time}}.\n\nАвтомобиль: {{vehicleName}}\nУслуга: {{serviceName}}",
    variablesJson: ["clientName", "date", "time", "vehicleName", "serviceName"],
  },
  {
    id: "tpl-need-vin",
    key: "need_vin",
    title: "Нужен VIN",
    text: "Подскажите, пожалуйста, VIN или госномер автомобиля — так мы точнее подберём расходники.",
    variablesJson: [],
  },
  {
    id: "tpl-estimate-ready",
    key: "estimate_ready",
    title: "Расчёт готов",
    text: "Расчёт готов:\n{{summary}}\n\nИтого: {{amount}} ₽",
    variablesJson: ["summary", "amount"],
  },
  {
    id: "tpl-task-assigned",
    key: "task_assigned",
    title: "Назначена задача",
    text: "Вам назначена задача:\n{{taskTitle}}\n\nСрок: {{dueAt}}",
    variablesJson: ["taskTitle", "dueAt"],
  },
  {
    id: "tpl-case-overdue",
    key: "case_overdue",
    title: "Просрочено дело",
    text: "Просрочено дело клиента:\n{{caseTitle}}\n\nКлиент: {{clientName}}\nСрок: {{dueAt}}",
    variablesJson: ["caseTitle", "clientName", "dueAt"],
  },
  {
    id: "tpl-appointment-today-summary",
    key: "appointment_today_summary",
    title: "Сводка записей на сегодня",
    text: "Сводка записей на сегодня:\n{{summary}}",
    variablesJson: ["summary"],
  },
  { id: "tpl-hello", key: "hello", title: "Здравствуйте", text: "Здравствуйте!", variablesJson: [] },
  { id: "tpl-vin", key: "vin_request", title: "Запрос VIN", text: "Подскажите VIN, пожалуйста", variablesJson: [] },
  { id: "tpl-record", key: "appointment_offer", title: "Запись", text: "Можем записать вас на удобное время", variablesJson: [] },
  { id: "tpl-stock-ok", key: "stock_available", title: "В наличии", text: "Расходники есть в наличии", variablesJson: [] },
  { id: "tpl-stock-wait", key: "stock_waiting", title: "Ожидаются", text: "Расходники ожидаются", variablesJson: [] },
  { id: "tpl-thanks", key: "thanks_waiting", title: "Спасибо", text: "Спасибо, будем ждать", variablesJson: [] },
  { id: "tpl-welcome-back", key: "welcome_back", title: "Обращайтесь", text: "Хорошо, обращайтесь", variablesJson: [] },
];

export const attachmentActions = [
  "Отправить фото",
  "Отправить файл",
  "Отправить отчёт диагностики",
  "Отправить предчек",
  "Отправить ссылку на запись",
  "Отправить карточку отгрузки",
  "Быстрый ответ",
];

export const gatewayEndpoints = [
  "GET /api/messenger/conversations",
  "GET /api/messenger/conversations/:id",
  "GET /api/messenger/conversations/:id/messages",
  "POST /api/messenger/conversations/:id/messages",
  "POST /api/messenger/conversations/:id/read",
  "POST /api/messenger/conversations/:id/archive",
  "POST /api/messenger/conversations/:id/pin",
  "POST /api/messenger/conversations/:id/important",
  "POST /api/messenger/conversations/:id/link-client",
  "POST /api/messenger/conversations/:id/create-case",
  "POST /api/messenger/conversations/:id/send-diagnostic-report",
  "POST /api/messenger/link-token",
  "GET /api/messenger/channels",
  "GET /api/messenger/templates",
  "POST /api/messenger/telegram/set-webhook",
  "GET /api/messenger/telegram/webhook-info",
  "POST /api/messenger/outbox/process",
];

export const MESSENGER_DEV_TOOLS_ENABLED =
  process.env.NEXT_PUBLIC_MESSENGER_DEV_TOOLS === "true" || process.env.NODE_ENV !== "production";

const TELEGRAM_PLACEHOLDER_RE = /^\s*\[Вложение Telegram\]\s*$/i;

export function isTelegramAttachmentPlaceholder(value?: string | null) {
  return TELEGRAM_PLACEHOLDER_RE.test(value ?? "");
}

export function attachmentLabel(attachment?: Attachment) {
  if (!attachment) return "Вложение";
  if (attachment.type === "image") return "Фото";
  if (attachment.type === "video") return "Видео";
  if (attachment.type === "voice") return "Голосовое";
  if (attachment.type === "audio") return "Аудио";
  if (attachment.type === "link") return "Ссылка";
  if (attachment.type === "contact") return "Контакт";
  if (attachment.type === "location") return "Геопозиция";
  if (attachment.type === "document") return "Документ";
  if (attachment.type === "unsupported") return "Неподдерживаемое вложение";
  return "Файл";
}

export function messagePreviewText(input: { text?: string | null; attachments?: Attachment[] }) {
  const text = input.text?.trim() ?? "";
  const attachments = input.attachments ?? [];
  if (text && !isTelegramAttachmentPlaceholder(text)) return text;
  if (attachments.length === 1) return attachmentLabel(attachments[0]);
  if (attachments.length > 1) return `${attachmentLabel(attachments[0])} и ещё ${attachments.length - 1}`;
  return "Сообщение без текста";
}

export function safeMessageText(value?: string | null) {
  const text = value?.trim() ?? "";
  return isTelegramAttachmentPlaceholder(text) ? "" : text;
}

export function connectionStatusLabel(status?: ChannelConnectionStatus | string) {
  if (status === "connected") return "подключён";
  if (status === "error") return "ошибка";
  if (status === "dry_run") return "dry-run";
  if (status === "disabled") return "отключён";
  return "не подключён";
}

export const mockClientContexts: Record<string, MessengerClientContext> = {
  "c-247": {
    id: "c-247",
    name: "Алексей Соловьёв",
    phone: "+7 911 487 22 14",
    type: "Физлицо",
    vehicle: {
      id: "v-bmw-x5",
      label: "BMW X5 xDrive40i (G05)",
      plate: "А 247 МК 39",
      vin: "WBABA91070AL55203",
    },
    activeCase: {
      id: "D-2026-0066",
      title: "Замена масла BMW X5",
      status: "В работе",
      responsible: "Сергей Игнатенко",
      deadline: "сегодня 15:30",
    },
    appointment: {
      id: "A-465",
      date: "сегодня 14:30",
      service: "Замена масла BMW",
      status: "Подтверждён",
    },
    shipments: [
      { id: "TGM-2026-0438", title: "Черновик отгрузки", amount: "6 450 ₽", status: "Черновик" },
      { id: "TGM-2026-0432", title: "Замена масла", amount: "7 290 ₽", status: "Завершено" },
    ],
    diagnostics: [{ id: "TGM-2026-0436", title: "Диагностика 14 пунктов", status: "Отчёт готов", publicReportUrl: "/report/demo-bmw-x5" }],
    tasks: [{ id: "T-118", title: "Отправить предчек", status: "Открыта" }],
  },
  "c-318": {
    id: "c-318",
    name: "Игорь Михайлов",
    phone: "+7 911 384 12 56",
    type: "Физлицо",
    vehicle: {
      id: "v-audi-q7",
      label: "Audi Q7 3.0 TDI",
      plate: "М 318 ОР 39",
      vin: "WAUZZZ4M0KD041318",
    },
    activeCase: {
      id: "D-2026-0068",
      title: "Замена ATF DSG DL382",
      status: "Требует ответа",
      responsible: "Сергей Игнатенко",
      deadline: "сегодня 14:00",
      overdue: true,
    },
    appointment: {
      id: "A-461",
      date: "сегодня 09:00",
      service: "Замена ATF DSG DL382",
      status: "В работе",
    },
    shipments: [{ id: "TGM-2026-0437", title: "ATF и фильтр", amount: "21 800 ₽", status: "В работе" }],
    diagnostics: [{ id: "DG-318", title: "АКПП: рекомендации", status: "В работе", publicReportUrl: "/report/demo-audi-q7" }],
    tasks: [{ id: "T-121", title: "Согласовать промывку", status: "Просрочена" }],
  },
  "c-512": {
    id: "c-512",
    name: "Ольга Дворецкая",
    phone: "+7 911 654 28 71",
    type: "Физлицо",
    vehicle: {
      id: "v-mercedes-e",
      label: "Mercedes E 220 d",
      plate: "Е 512 АН 39",
      vin: "WDD2130041A512871",
    },
    appointment: {
      id: "A-468",
      date: "сегодня 15:30",
      service: "Доливка ATF",
      status: "Подтверждён",
    },
    shipments: [{ id: "TGM-2026-0435", title: "Масло и фильтры", amount: "17 400 ₽", status: "Завершено" }],
    diagnostics: [],
    tasks: [{ id: "T-125", title: "Перезвонить завтра", status: "Запланирована" }],
  },
};

export const mockConversations: Conversation[] = [
  {
    id: "conv-telegram-soloviev",
    channel: "telegram",
    externalConversationId: "tg:79214872214",
    title: "BMW X5 · замена масла",
    participantName: "Алексей Соловьёв",
    participantPhone: "+7 911 487 22 14",
    lastMessageText: "Подтверждаю запись на 14:30, подъеду за 10 минут.",
    lastMessageAt: "2026-06-16T13:42:00+02:00",
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
    id: "conv-whatsapp-q7",
    channel: "whatsapp",
    externalConversationId: "wa:79113841256",
    title: "Audi Q7 · ATF",
    participantName: "Игорь Михайлов",
    participantPhone: "+7 911 384 12 56",
    lastMessageText: "Если успеете сегодня, согласую промывку и фильтр.",
    lastMessageAt: "2026-06-16T12:58:00+02:00",
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
    id: "conv-vk-dvoretskaya",
    channel: "vk",
    externalConversationId: "vk:512871",
    title: "Mercedes · доливка ATF",
    participantName: "Ольга Дворецкая",
    participantPhone: "+7 911 654 28 71",
    lastMessageText: "Можно перенести запись на 16:00?",
    lastMessageAt: "2026-06-16T11:20:00+02:00",
    unreadCount: 0,
    isPinned: false,
    isImportant: false,
    status: "waiting",
    kind: "client",
    clientId: "c-512",
    vehicleId: "v-mercedes-e",
    appointmentId: "A-468",
    assignedTo: "Анна Лебедева",
    tags: ["запись", "перенос"],
  },
  {
    id: "conv-avito-unknown",
    channel: "avito",
    externalConversationId: "avito:lead-8831",
    title: "Подбор масла по VIN",
    participantName: "Клиент Avito",
    participantPhone: "+7 911 000 44 88",
    lastMessageText: "Здравствуйте, нужна цена масла и фильтра по VIN.",
    lastMessageAt: "2026-06-16T10:05:00+02:00",
    unreadCount: 0,
    isPinned: false,
    isImportant: false,
    status: "open",
    kind: "unknown",
    assignedTo: "Анна Лебедева",
    tags: ["без клиента", "VIN"],
  },
  {
    id: "conv-instagram-levin",
    channel: "instagram",
    externalConversationId: "ig:levin200",
    title: "Toyota LC 200 · расходники",
    participantName: "Дмитрий Левин",
    participantPhone: "+7 911 555 19 03",
    lastMessageText: "Расходники есть в наличии?",
    lastMessageAt: "2026-06-15T18:44:00+02:00",
    unreadCount: 0,
    isPinned: false,
    isImportant: false,
    status: "open",
    kind: "client",
    assignedTo: "Анна Лебедева",
    tags: ["Toyota", "расходники"],
  },
  {
    id: "conv-max-supplier",
    channel: "max",
    externalConversationId: "max:alpha-oil",
    title: "Альфа-Ойл · счёт поставщика",
    participantName: "Альфа-Ойл",
    lastMessageText: "Счёт 7842 обновили, позиции Shell подтверждены.",
    lastMessageAt: "2026-06-15T16:18:00+02:00",
    unreadCount: 0,
    isPinned: false,
    isImportant: true,
    status: "waiting",
    kind: "supplier",
    assignedTo: "Дмитрий Косов",
    tags: ["поставщик", "счёт"],
  },
  {
    id: "conv-website-lead",
    channel: "website",
    externalConversationId: "site:lead-924",
    title: "Заявка с сайта",
    participantName: "Новый клиент",
    participantPhone: "+7 911 777 91 42",
    lastMessageText: "Оставил заявку на диагностику подвески.",
    lastMessageAt: "2026-06-15T13:12:00+02:00",
    unreadCount: 0,
    isPinned: false,
    isImportant: false,
    status: "open",
    kind: "unknown",
    assignedTo: "Анна Лебедева",
    tags: ["без клиента", "диагностика"],
  },
  {
    id: "conv-mock-master",
    channel: "mock",
    externalConversationId: "mock:master1",
    title: "Тестовый диалог",
    participantName: "Mock сотрудник",
    lastMessageText: "Тестовое сообщение через mock adapter.",
    lastMessageAt: "2026-06-15T11:36:00+02:00",
    unreadCount: 0,
    isPinned: false,
    isImportant: false,
    status: "open",
    kind: "employee",
    assignedTo: "Сергей Игнатенко",
    tags: ["mock", "адаптер"],
  },
];

export const mockMessages: Record<string, Message[]> = {
  "conv-telegram-soloviev": [
    {
      id: "m-tg-1",
      conversationId: "conv-telegram-soloviev",
      direction: "system",
      authorName: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
      authorType: "system",
      text: "Клиент привязан к карточке Алексей Соловьёв.",
      attachments: [],
      createdAt: "2026-06-16T09:10:00+02:00",
      status: "read",
    },
    {
      id: "m-tg-2",
      conversationId: "conv-telegram-soloviev",
      direction: "inbound",
      authorName: "Алексей Соловьёв",
      authorType: "client",
      text: "Добрый день! Можно сегодня заменить масло на X5?",
      attachments: [],
      createdAt: "2026-06-16T09:12:00+02:00",
      status: "read",
      channelMessageId: "tg-101",
    },
    {
      id: "m-tg-3",
      conversationId: "conv-telegram-soloviev",
      direction: "outbound",
      authorName: "Анна Лебедева",
      authorType: "employee",
      text: "Здравствуйте! Можем записать вас на 14:30. Расходники есть в наличии, предчек подготовлю.",
      attachments: [],
      createdAt: "2026-06-16T09:18:00+02:00",
      status: "read",
      channelMessageId: "tg-102",
    },
    {
      id: "m-tg-4",
      conversationId: "conv-telegram-soloviev",
      direction: "system",
      authorName: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
      authorType: "system",
      text: "Создана запись A-465 на сегодня 14:30.",
      attachments: [],
      createdAt: "2026-06-16T09:19:00+02:00",
      status: "read",
    },
    {
      id: "m-tg-5",
      conversationId: "conv-telegram-soloviev",
      direction: "inbound",
      authorName: "Алексей Соловьёв",
      authorType: "client",
      text: "Подтверждаю запись на 14:30, подъеду за 10 минут.",
      attachments: [],
      createdAt: "2026-06-16T13:42:00+02:00",
      status: "delivered",
      channelMessageId: "tg-103",
    },
  ],
  "conv-whatsapp-q7": [
    {
      id: "m-wa-1",
      conversationId: "conv-whatsapp-q7",
      direction: "inbound",
      authorName: "Игорь Михайлов",
      authorType: "client",
      text: "Доброе утро. По Q7 нужна замена ATF. Что по срокам?",
      attachments: [],
      createdAt: "2026-06-16T08:40:00+02:00",
      status: "read",
    },
    {
      id: "m-wa-2",
      conversationId: "conv-whatsapp-q7",
      direction: "outbound",
      authorName: "Анна Лебедева",
      authorType: "employee",
      text: "Записали на 09:00. Мастер посмотрит состояние масла и скажет по промывке.",
      attachments: [],
      createdAt: "2026-06-16T08:46:00+02:00",
      status: "delivered",
    },
    {
      id: "m-wa-3",
      conversationId: "conv-whatsapp-q7",
      direction: "system",
      authorName: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
      authorType: "system",
      text: "Создано дело D-2026-0068, дедлайн ответа сегодня 14:00.",
      attachments: [],
      createdAt: "2026-06-16T09:02:00+02:00",
      status: "read",
    },
    {
      id: "m-wa-4",
      conversationId: "conv-whatsapp-q7",
      direction: "inbound",
      authorName: "Игорь Михайлов",
      authorType: "client",
      text: "Если успеете сегодня, согласую промывку и фильтр.",
      attachments: [],
      createdAt: "2026-06-16T12:58:00+02:00",
      status: "delivered",
    },
    {
      id: "m-wa-5",
      conversationId: "conv-whatsapp-q7",
      direction: "outbound",
      authorName: "Анна Лебедева",
      authorType: "employee",
      text: "Предчек отправляю повторно.",
      attachments: [],
      createdAt: "2026-06-16T13:06:00+02:00",
      status: "failed",
    },
  ],
  "conv-vk-dvoretskaya": [
    {
      id: "m-vk-1",
      conversationId: "conv-vk-dvoretskaya",
      direction: "inbound",
      authorName: "Ольга Дворецкая",
      authorType: "client",
      text: "Можно перенести запись на 16:00?",
      attachments: [],
      createdAt: "2026-06-16T11:20:00+02:00",
      status: "read",
    },
    {
      id: "m-vk-2",
      conversationId: "conv-vk-dvoretskaya",
      direction: "outbound",
      authorName: "Анна Лебедева",
      authorType: "employee",
      text: "Да, перенесли. Подтверждение записи отправлю отдельным сообщением.",
      attachments: [],
      createdAt: "2026-06-16T11:27:00+02:00",
      status: "sent",
    },
  ],
};

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function formatMessengerTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date("2026-06-16T14:00:00+02:00");
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === yesterday.toDateString()) return "вчера";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function formatMessageDay(value: string) {
  const date = new Date(value);
  const now = new Date("2026-06-16T14:00:00+02:00");
  if (date.toDateString() === now.toDateString()) return "Сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
