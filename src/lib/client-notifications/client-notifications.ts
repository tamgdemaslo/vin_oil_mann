import crypto from "crypto";
import type { NextRequest } from "next/server";
import {
  diagnosticCriticalText,
  diagnosticRecommendationText,
  nonNegativeCount,
  stripDiagnosticReportLink,
} from "@/lib/diagnostic-report-message";
import { buildDiagnosticReportUrl } from "@/lib/diagnostic-report-link";
import { prisma } from "@/lib/db";
import {
  formatServiceDate,
  formatServiceDateTime,
  formatServiceTime,
  parseServiceDateTime,
  SERVICE_TIME_ZONE,
} from "@/lib/date-time";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { listMessengerChannels, sendMessage } from "@/lib/messenger/messenger-gateway";
import { startContactConversation } from "@/lib/messenger/messenger-contact-actions";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import { assertMessengerOutboundTextSafe } from "@/lib/messenger/messenger-security";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";

export type ClientNotificationEventType =
  | "appointment_client_created"
  | "appointment_admin_created"
  | "appointment_reminder"
  | "diagnostic_sent"
  | "client_arrived"
  | "visit_completed"
  | "review_after_visit"
  | "appointment_rescheduled"
  | "appointment_cancelled"
  | "appointment_no_show"
  | "estimate_sent"
  | "precheck_sent"
  | "order_ready"
  | "vehicle_ready"
  | "payment_received"
  | "debt_reminder"
  | "parts_arrived"
  | "repeat_visit"
  | "oil_change_reminder";

type JsonRecord = Record<string, unknown>;

type NotificationTemplateRow = {
  id: string;
  organizationId: string;
  name: string;
  eventType: ClientNotificationEventType;
  channel: "telegram" | string;
  body: string;
  isActive: boolean;
  branchId: string | null;
  status: string;
  metadataJson: JsonRecord;
  createdAt: Date;
  updatedAt: Date;
};

type NotificationRuleRow = {
  id: string;
  organizationId: string;
  eventType: ClientNotificationEventType;
  enabled: boolean;
  channel: "telegram" | string;
  templateId: string;
  timingType: "immediate" | "before_appointment" | "delayed_after_event" | string;
  offsetMinutes: number | null;
  conditionsJson: NotificationConditions;
  branchId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type NotificationJobRow = {
  id: string;
  organizationId: string;
  eventType: ClientNotificationEventType;
  channel: "telegram" | string;
  clientId: string | null;
  appointmentId: string | null;
  diagnosticReportId: string | null;
  templateId: string;
  scheduledAt: Date;
  status: NotificationJobStatus;
  idempotencyKey: string;
  payloadJson: JsonRecord;
  errorMessage: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  providerMessageId: string | null;
  messengerMessageId: string | null;
  messengerOutboxId: string | null;
  conversationId: string | null;
  branchId: string | null;
  initiatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type NotificationLogRow = {
  id: string;
  organizationId: string;
  notificationJobId: string | null;
  eventType: ClientNotificationEventType;
  channel: string;
  clientId: string | null;
  appointmentId: string | null;
  diagnosticReportId: string | null;
  templateId: string | null;
  status: NotificationJobStatus;
  renderedMessage: string | null;
  errorMessage: string | null;
  providerMessageId: string | null;
  initiatedById: string | null;
  metadataJson: JsonRecord;
  createdAt: Date;
};

type NotificationSettingsRow = {
  id: string;
  organizationId: string;
  settingsJson: JsonRecord;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationJobStatus =
  | "scheduled"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "error"
  | "cancelled"
  | "skipped"
  | "client_not_connected"
  | "no_consent"
  | "duplicate_blocked"
  | "template_error";

export type NotificationConditions = {
  requireTelegram?: boolean;
  requireConsent?: boolean;
  preventDuplicates?: boolean;
  skipCancelled?: boolean;
  doNotSendAtNight?: boolean;
  quietHours?: { from?: string; to?: string };
  timezone?: string;
  minNoticeMinutes?: number;
  arrivalStatuses?: string[];
  branchIds?: string[];
  excludedAppointmentTypes?: string[];
  reviewDelayMinutes?: number;
  requireReviewLink?: boolean;
};

export type NotificationEventContext = {
  eventType?: ClientNotificationEventType;
  clientId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  appointmentId?: string | null;
  appointmentAt?: string | Date | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  diagnosticReportId?: string | null;
  diagnosticReportLink?: string | null;
  reviewLink?: string | null;
  orderLink?: string | null;
  precheckLink?: string | null;
  car?: string | null;
  carMake?: string | null;
  carModel?: string | null;
  licensePlate?: string | null;
  vin?: string | null;
  serviceList?: string | null;
  managerName?: string | null;
  masterName?: string | null;
  organizationName?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  routeSchemeUrl?: string | null;
  routeSchemeImageUrl?: string | null;
  routeSchemeCaption?: string | null;
  yandexMapsUrl?: string | null;
  yandexReviewUrl?: string | null;
  waitingAreaText?: string | null;
  coffeeTeaText?: string | null;
  receptionManagerText?: string | null;
  wifiName?: string | null;
  wifiPassword?: string | null;
  publicPhone?: string | null;
  telegramUsername?: string | null;
  bookingUrl?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  address?: string | null;
  companyPhone?: string | null;
  telegramLink?: string | null;
  checkedCount?: number | null;
  recommendationCount?: number | null;
  criticalCount?: number | null;
  warningCount?: number | null;
  status?: string | null;
  isCancelled?: boolean;
  initiatedById?: string | null;
  source?: string | null;
  payload?: JsonRecord | null;
  force?: boolean;
};

export type ClientNotificationSettings = {
  locationAddress: string;
  routeSchemeUrl: string;
  routeSchemeImageUrl: string;
  routeSchemeCaption: string;
  yandexMapsUrl: string;
  yandexReviewUrl: string;
  waitingAreaText: string;
  coffeeTeaText: string;
  receptionManagerText: string;
  wifiName: string;
  wifiPassword: string;
  postVisitReviewEnabled: boolean;
  reviewDelayHours: number;
  sendReviewOnlyIfShipmentCompleted: boolean;
};

type RenderResult = {
  text: string;
  variables: Record<string, string>;
  missingVariables: string[];
  unknownVariables: string[];
  variableDetails: NotificationVariablePreview[];
};

export type NotificationVariableDefinition = {
  key: string;
  title: string;
  description: string;
  source: string;
  example: string;
  emptyBehavior: string;
};

export type NotificationVariableGroup = {
  title: string;
  variables: NotificationVariableDefinition[];
};

export type NotificationVariablePreview = NotificationVariableDefinition & {
  value: string;
  used: boolean;
  missing: boolean;
};

type ConversationTarget = {
  id: string;
  externalConversationId: string;
  messengerAccountId: string | null;
  clientId: string | null;
};

type NotificationCounterpartyRow = {
  id: string;
  name: string;
  phone: string | null;
  normalizedPhone: string | null;
};

type TelegramConnectionTarget = {
  id: string;
  externalChatId: string;
  displayName: string;
  phone: string | null;
  clientId: string | null;
};

const schemaState = globalThis as typeof globalThis & {
  __clientNotificationsSchemaPromise?: Promise<void> | null;
};

export const notificationEventDefinitions: Array<{
  type: ClientNotificationEventType;
  title: string;
  description: string;
  defaultTiming: string;
  future?: boolean;
}> = [
  {
    type: "appointment_client_created",
    title: "Новая запись от клиента",
    description: "Клиент сам создал запись через публичную форму или виджет.",
    defaultTiming: "Сразу после создания",
  },
  {
    type: "appointment_admin_created",
    title: "Новая запись от администратора",
    description: "Администратор создал запись в журнале записи.",
    defaultTiming: "Сразу после создания",
  },
  {
    type: "appointment_reminder",
    title: "Напоминание перед визитом",
    description: "Планируется относительно времени записи и пересчитывается при переносе.",
    defaultTiming: "За 3 часа до записи",
  },
  {
    type: "diagnostic_sent",
    title: "Диагностика готова",
    description: "Клиент получает ссылку на публичный отчёт диагностики.",
    defaultTiming: "После нажатия «Отправить клиенту»",
  },
  {
    type: "client_arrived",
    title: "Приветствие в сервисе",
    description: "Короткое полезное сообщение после отметки приезда клиента.",
    defaultTiming: "Сразу после приезда",
  },
  {
    type: "visit_completed",
    title: "Визит завершён",
    description: "Запасное событие для ручного сценария по кнопке «Уехал».",
    defaultTiming: "Выключено",
    future: true,
  },
  {
    type: "review_after_visit",
    title: "Отзыв после визита",
    description: "Мягкая просьба оставить отзыв, планируется автоматически после приезда.",
    defaultTiming: "Через 6 часов после приезда",
  },
  { type: "appointment_rescheduled", title: "Запись перенесена", description: "Будущее событие для переноса записи.", defaultTiming: "Сразу", future: true },
  { type: "appointment_cancelled", title: "Запись отменена", description: "Будущее событие для отмены записи.", defaultTiming: "Сразу", future: true },
  { type: "appointment_no_show", title: "Клиент не приехал", description: "Шаблон для ручной отправки после no-show.", defaultTiming: "Вручную", future: true },
  { type: "estimate_sent", title: "Расчёт отправлен", description: "Расширение для отправки расчёта клиенту.", defaultTiming: "Сразу", future: true },
  { type: "precheck_sent", title: "Предчек отправлен", description: "Расширение для предчека.", defaultTiming: "Сразу", future: true },
  { type: "order_ready", title: "Заказ готов", description: "Расширение для готовности заказа.", defaultTiming: "Сразу", future: true },
  { type: "vehicle_ready", title: "Автомобиль готов к выдаче", description: "Расширение для выдачи автомобиля.", defaultTiming: "Сразу", future: true },
  { type: "payment_received", title: "Оплата получена", description: "Расширение для оплаты.", defaultTiming: "Сразу", future: true },
  { type: "debt_reminder", title: "Долг / неоплаченный документ", description: "Расширение для задолженности.", defaultTiming: "По расписанию", future: true },
  { type: "parts_arrived", title: "Товар приехал", description: "Расширение для прихода товара.", defaultTiming: "Сразу", future: true },
  { type: "repeat_visit", title: "Повторный визит", description: "Расширение для повторного визита через N дней.", defaultTiming: "По расписанию", future: true },
  { type: "oil_change_reminder", title: "Напоминание о замене масла", description: "Расширение по пробегу или дате.", defaultTiming: "По расписанию", future: true },
];

function variable(
  key: string,
  title: string,
  description: string,
  source: string,
  example: string,
  emptyBehavior: string
): NotificationVariableDefinition {
  return { key, title, description, source, example, emptyBehavior };
}

export const notificationVariableGroups: NotificationVariableGroup[] = [
  {
    title: "Клиент",
    variables: [
      variable("clientName", "Имя клиента", "Имя из карточки клиента или записи.", "Карточка клиента / запись", "Александр", "Если пусто, приветствие станет нейтральным."),
      variable("clientPhone", "Телефон клиента", "Телефон клиента в привычном формате.", "Карточка клиента / запись", "+7 999 255-60-31", "Строки с телефоном лучше делать условными."),
    ],
  },
  {
    title: "Запись",
    variables: [
      variable("appointmentDate", "Дата записи", "Дата визита клиента.", "Журнал записи", "7 июля 2026", "Если даты нет, шаблон покажет ошибку предпросмотра."),
      variable("appointmentTime", "Время записи", "Время начала визита.", "Журнал записи", "13:00", "Если времени нет, шаблон покажет ошибку предпросмотра."),
      variable("appointmentDateTime", "Дата и время", "Дата и время визита одной строкой.", "Журнал записи", "7 июля 2026, 13:00", "Можно заменить отдельными датой и временем."),
      variable("serviceName", "Услуга", "Основная услуга или список работ из записи.", "Журнал записи / услуги", "Замена моторного масла", "Строку с услугой можно скрыть условным блоком."),
      variable("serviceList", "Список услуг", "Полный список услуг из записи.", "Журнал записи / услуги", "Замена масла, фильтр", "Строку можно скрыть условным блоком."),
      variable("managerName", "Менеджер", "Ответственный менеджер.", "Запись / пользователь", "Игорь", "Пустое значение скрывайте условным блоком."),
      variable("masterName", "Мастер", "Мастер или сотрудник.", "Запись / сотрудник", "Денис", "Пустое значение скрывайте условным блоком."),
    ],
  },
  {
    title: "Автомобиль",
    variables: [
      variable("vehicleDisplayName", "Автомобиль", "Готовое название авто: марка, модель, госномер или VIN.", "Авто клиента / запись", "BMW X5 · A123BC", "Если авто не указано, условный блок полностью скрывает строку."),
      variable("vehicleBrand", "Марка", "Марка автомобиля.", "Авто клиента / запись", "BMW", "Пустое значение не подставляется автоматически."),
      variable("vehicleModel", "Модель", "Модель автомобиля.", "Авто клиента / запись", "X5", "Пустое значение не подставляется автоматически."),
      variable("vehiclePlate", "Госномер", "Регистрационный номер.", "Авто клиента / запись", "A123BC", "Пустое значение не подставляется автоматически."),
      variable("vehicleVin", "VIN", "VIN автомобиля.", "Авто клиента / запись", "WBABA91070AL55203", "Пустое значение не подставляется автоматически."),
    ],
  },
  {
    title: "Сервис",
    variables: [
      variable("organizationName", "Название сервиса", "Публичное название организации.", "Настройки сервиса", "Там где масло", "Если не задано, используется название по умолчанию."),
      variable("locationName", "Филиал", "Название локации или бокса.", "Запись / филиал", "Бокс №1", "Пустое значение скрывайте условным блоком."),
      variable("locationAddress", "Адрес", "Адрес филиала.", "Запись / настройки", "Калининград, ул. Дачная, 6В", "Строка адреса скрывается, если адрес пустой."),
      variable("publicPhone", "Телефон сервиса", "Публичный телефон для связи.", "Настройки сервиса", "+7 4012 00-00-00", "Пустое значение скрывайте условным блоком."),
      variable("telegramUsername", "Telegram сервиса", "Ссылка или username Telegram.", "Настройки сервиса", "@tam_gde_maslo", "Пустое значение скрывайте условным блоком."),
      variable("bookingUrl", "Ссылка записи", "Публичная ссылка для самостоятельной записи.", "Настройки онлайн-записи", "https://example.com/book", "Пустое значение скрывайте условным блоком."),
      variable("routeSchemeUrl", "Схема проезда", "Ссылка на схему проезда или изображение.", "Настройки уведомлений", "https://example.com/route", "Строка скрывается, если схема не указана."),
      variable("routeSchemeImageUrl", "Фото схемы", "Ссылка на фото схемы проезда.", "Настройки уведомлений", "https://example.com/route.jpg", "Строка скрывается, если фото не указано."),
      variable("routeSchemeCaption", "Подпись схемы", "Короткая подсказка к схеме проезда.", "Настройки уведомлений", "Заезд со стороны ворот бокса №1", "Строка скрывается, если подпись не указана."),
      variable("yandexMapsUrl", "Яндекс.Карты", "Ссылка на точку сервиса в Яндекс.Картах.", "Настройки уведомлений", "https://yandex.ru/maps/-/demo", "Строка скрывается, если ссылка не указана."),
      variable("yandexReviewUrl", "Ссылка на отзыв", "Ссылка, куда клиенту удобно оставить отзыв.", "Настройки уведомлений", "https://yandex.ru/maps/org/demo/reviews", "Поствизитное сообщение не создаётся без ссылки."),
      variable("waitingAreaText", "Зона ожидания", "Фраза про зону ожидания.", "Настройки уведомлений", "Вы можете пройти в зону ожидания.", "Строка скрывается, если текст пустой."),
      variable("coffeeTeaText", "Чай и кофе", "Фраза про чай, кофе или воду.", "Настройки уведомлений", "Можно взять чай или кофе.", "Строка скрывается, если текст пустой."),
      variable("receptionManagerText", "Помощь мастера", "Фраза о том, к кому обратиться на месте.", "Настройки уведомлений", "Если будет непонятно, спросите мастер-приёмщика.", "Строка скрывается, если текст пустой."),
      variable("wifiName", "Wi‑Fi сеть", "Название Wi‑Fi для клиента.", "Настройки уведомлений", "TGM Guest", "Строка скрывается, если сеть не указана."),
      variable("wifiPassword", "Wi‑Fi пароль", "Пароль гостевого Wi‑Fi.", "Настройки уведомлений", "oil2026", "Строка скрывается, если пароль не указан."),
    ],
  },
  {
    title: "Ссылки",
    variables: [
      variable("diagnosticReportUrl", "Отчёт диагностики", "Публичная ссылка на отчёт диагностики.", "Диагностика", "https://example.com/report/demo", "Если ссылки нет, сообщение не должно содержать строку отчёта."),
      variable("precheckUrl", "Предчек", "Ссылка на предчек.", "Документы", "https://example.com/precheck/demo", "Пустое значение скрывайте условным блоком."),
      variable("reviewUrl", "Отзыв", "Ссылка на страницу отзыва.", "Настройки уведомлений", "https://yandex.ru/maps/org/demo/reviews", "Пустое значение скрывайте условным блоком."),
      variable("orderUrl", "Заказ", "Ссылка на заказ или документ.", "Документы", "https://example.com/order/demo", "Пустое значение скрывайте условным блоком."),
    ],
  },
  {
    title: "Диагностика",
    variables: [
      variable("checkedCount", "Проверено", "Количество проверенных пунктов.", "Диагностика", "24", "Если нет данных, подставляется 0."),
      variable("recommendationCount", "Рекомендации", "Количество рекомендаций.", "Диагностика", "3", "Если нет данных, подставляется 0."),
      variable("criticalCount", "Критично", "Количество критичных замечаний.", "Диагностика", "1", "Если нет данных, подставляется 0."),
      variable("warningCount", "Внимание", "Количество пунктов внимания.", "Диагностика", "3", "Если нет данных, подставляется 0."),
      variable("recommendationText", "Текст рекомендаций", "Готовая фраза по рекомендациям.", "Диагностика", "Есть 3 рекомендации.", "Фраза адаптируется по количеству."),
      variable("criticalText", "Текст критичных пунктов", "Готовая фраза по критичным пунктам.", "Диагностика", "Есть 1 критичный пункт.", "Фраза адаптируется по количеству."),
    ],
  },
];

const notificationVariableDefinitions = notificationVariableGroups.flatMap((group) => group.variables);
const supportedVariableSet = new Set(notificationVariableDefinitions.map((item) => item.key));
const legacyVariableAliases = new Map<string, string>([
  ["client_name", "clientName"],
  ["client_phone", "clientPhone"],
  ["appointment_date", "appointmentDate"],
  ["appointment_time", "appointmentTime"],
  ["appointment_datetime", "appointmentDateTime"],
  ["service_name", "organizationName"],
  ["branch_name", "locationName"],
  ["address", "locationAddress"],
  ["route_scheme_url", "routeSchemeUrl"],
  ["route_scheme_image_url", "routeSchemeImageUrl"],
  ["route_scheme_caption", "routeSchemeCaption"],
  ["yandex_maps_url", "yandexMapsUrl"],
  ["yandex_review_url", "yandexReviewUrl"],
  ["wifi_name", "wifiName"],
  ["wifi_password", "wifiPassword"],
  ["company_phone", "publicPhone"],
  ["telegram_link", "telegramUsername"],
  ["service_list", "serviceList"],
  ["manager_name", "managerName"],
  ["master_name", "masterName"],
  ["car_make", "vehicleBrand"],
  ["car_model", "vehicleModel"],
  ["license_plate", "vehiclePlate"],
  ["vin", "vehicleVin"],
  ["diagnostic_report_link", "diagnosticReportUrl"],
  ["review_link", "reviewUrl"],
  ["order_link", "orderUrl"],
  ["precheck_link", "precheckUrl"],
  ["checked_count", "checkedCount"],
  ["recommendation_count", "recommendationCount"],
  ["critical_count", "criticalCount"],
  ["warning_count", "warningCount"],
  ["recommendation_text", "recommendationText"],
  ["critical_text", "criticalText"],
]);

function canonicalVariableKey(key: string) {
  return supportedVariableSet.has(key) ? key : legacyVariableAliases.get(key);
}

const defaultConditions: NotificationConditions = {
  requireTelegram: true,
  requireConsent: true,
  preventDuplicates: true,
  skipCancelled: true,
  doNotSendAtNight: false,
  quietHours: { from: "22:00", to: "09:00" },
  timezone: SERVICE_TIME_ZONE,
  minNoticeMinutes: 30,
};

const defaultClientNotificationSettings: ClientNotificationSettings = {
  locationAddress: "Калининград, ул. Дачная, 6В",
  routeSchemeUrl: "",
  routeSchemeImageUrl: "",
  routeSchemeCaption: "",
  yandexMapsUrl: "",
  yandexReviewUrl: "",
  waitingAreaText: "Вы можете пройти в зону ожидания.",
  coffeeTeaText: "У нас можно выпить чай или кофе.",
  receptionManagerText: "Если будет непонятно, куда пройти или чем воспользоваться, спросите мастер-приёмщика — мы подскажем.",
  wifiName: "",
  wifiPassword: "",
  postVisitReviewEnabled: true,
  reviewDelayHours: 6,
  sendReviewOnlyIfShipmentCompleted: false,
};

const legacyDiagnosticReadyTemplateBody =
  "Здравствуйте, {client_name}! Диагностика по автомобилю {car} готова. Посмотреть отчёт: {diagnostic_report_link}";
const appointmentConfirmTemplateBody =
  "{{#clientName}}Здравствуйте, {{clientName}}!{{/clientName}}{{^clientName}}Здравствуйте!{{/clientName}}\n" +
  "Вы записаны в {{organizationName}} на {{appointmentDate}} в {{appointmentTime}}." +
  "{{#serviceName}}\nУслуга: {{serviceName}}.{{/serviceName}}" +
  "{{#vehicleDisplayName}}\nАвтомобиль: {{vehicleDisplayName}}.{{/vehicleDisplayName}}" +
  "{{#locationAddress}}\nАдрес: {{locationAddress}}.{{/locationAddress}}" +
  "{{#yandexMapsUrl}}\nЯндекс.Карты: {{yandexMapsUrl}}{{/yandexMapsUrl}}" +
  "{{#routeSchemeUrl}}\nСхема проезда: {{routeSchemeUrl}}{{/routeSchemeUrl}}" +
  "{{#routeSchemeCaption}}\n{{routeSchemeCaption}}{{/routeSchemeCaption}}\n" +
  "Ждём вас.";
const diagnosticReadyTemplateBody =
  "{{#clientName}}{{clientName}}, диагностика{{#vehicleDisplayName}} {{vehicleDisplayName}}{{/vehicleDisplayName}} готова.{{/clientName}}" +
  "{{^clientName}}Диагностика{{#vehicleDisplayName}} {{vehicleDisplayName}}{{/vehicleDisplayName}} готова.{{/clientName}}\n\n" +
  "Проверено {{checkedCount}} пунктов.\n{{recommendationText}}\n{{criticalText}}" +
  "{{#diagnosticReportUrl}}\n\nОткрыть отчёт: {{diagnosticReportUrl}}{{/diagnosticReportUrl}}";

const defaultTemplates: Array<{
  key: string;
  name: string;
  eventType: ClientNotificationEventType;
  body: string;
  active?: boolean;
}> = [
  {
    key: "appointment-confirm",
    name: "Подтверждение записи",
    eventType: "appointment_client_created",
    body: appointmentConfirmTemplateBody,
  },
  {
    key: "appointment-admin-confirm",
    name: "Подтверждение записи",
    eventType: "appointment_admin_created",
    body: appointmentConfirmTemplateBody,
  },
  {
    key: "appointment-reminder",
    name: "Напоминание перед визитом",
    eventType: "appointment_reminder",
    body:
      "{{#clientName}}{{clientName}}, {{/clientName}}напоминаем о записи в {{organizationName}} {{appointmentDate}} в {{appointmentTime}}." +
      "{{#serviceName}}\nУслуга: {{serviceName}}.{{/serviceName}}" +
      "{{#vehicleDisplayName}}\nАвтомобиль: {{vehicleDisplayName}}.{{/vehicleDisplayName}}" +
      "{{#locationAddress}}\nАдрес: {{locationAddress}}.{{/locationAddress}}" +
      "{{#yandexMapsUrl}}\nЯндекс.Карты: {{yandexMapsUrl}}{{/yandexMapsUrl}}" +
      "{{#routeSchemeUrl}}\nСхема проезда: {{routeSchemeUrl}}{{/routeSchemeUrl}}" +
      "{{#routeSchemeCaption}}\n{{routeSchemeCaption}}{{/routeSchemeCaption}}\n" +
      "До встречи.",
  },
  {
    key: "diagnostic-ready",
    name: "Диагностика готова",
    eventType: "diagnostic_sent",
    body: diagnosticReadyTemplateBody,
  },
  {
    key: "client-arrived",
    name: "Клиент приехал",
    eventType: "client_arrived",
    body:
      "{{#clientName}}{{clientName}}, добро пожаловать в {{organizationName}}!{{/clientName}}" +
      "{{^clientName}}Добро пожаловать в {{organizationName}}!{{/clientName}}" +
      "{{#waitingAreaText}}\n{{waitingAreaText}}{{/waitingAreaText}}" +
      "{{#coffeeTeaText}}\n{{coffeeTeaText}}{{/coffeeTeaText}}" +
      "{{#wifiName}}\nWi‑Fi: {{wifiName}}{{#wifiPassword}}, пароль: {{wifiPassword}}{{/wifiPassword}}{{/wifiName}}" +
      "{{#receptionManagerText}}\n{{receptionManagerText}}{{/receptionManagerText}}",
  },
  {
    key: "visit-review",
    name: "Отзыв после визита",
    eventType: "review_after_visit",
    body:
      "{{#clientName}}{{clientName}}, спасибо, что выбрали {{organizationName}}.{{/clientName}}" +
      "{{^clientName}}Спасибо, что выбрали {{organizationName}}.{{/clientName}}\n" +
      "Если всё было хорошо, будем благодарны за отзыв — это помогает другим водителям выбрать сервис." +
      "{{#yandexReviewUrl}}\nОставить отзыв: {{yandexReviewUrl}}{{/yandexReviewUrl}}" +
      "{{^yandexReviewUrl}}{{#yandexMapsUrl}}\nОставить отзыв: {{yandexMapsUrl}}{{/yandexMapsUrl}}{{/yandexReviewUrl}}",
  },
  {
    key: "appointment-rescheduled",
    name: "Запись перенесена",
    eventType: "appointment_rescheduled",
    body:
      "{{#clientName}}Здравствуйте, {{clientName}}!{{/clientName}}{{^clientName}}Здравствуйте!{{/clientName}}\n" +
      "Ваша запись перенесена на {{appointmentDate}} в {{appointmentTime}}." +
      "{{#vehicleDisplayName}}\nАвтомобиль: {{vehicleDisplayName}}.{{/vehicleDisplayName}}",
  },
  {
    key: "appointment-cancelled",
    name: "Запись отменена",
    eventType: "appointment_cancelled",
    body:
      "{{#clientName}}Здравствуйте, {{clientName}}.{{/clientName}}{{^clientName}}Здравствуйте.{{/clientName}}\n" +
      "Ваша запись на {{appointmentDate}} в {{appointmentTime}} отменена. Если хотите выбрать другое время, напишите нам.",
  },
  {
    key: "appointment-no-show",
    name: "Клиент не приехал",
    eventType: "appointment_no_show",
    body:
      "{{#clientName}}{{clientName}}, здравствуйте.{{/clientName}}{{^clientName}}Здравствуйте.{{/clientName}}\n" +
      "Мы не дождались вас на запись {{appointmentDate}} в {{appointmentTime}}. Если нужно перенести визит, напишите нам.",
    active: false,
  },
  {
    key: "vehicle-ready",
    name: "Автомобиль готов",
    eventType: "vehicle_ready",
    body:
      "{{#clientName}}{{clientName}}, {{/clientName}}автомобиль{{#vehicleDisplayName}} {{vehicleDisplayName}}{{/vehicleDisplayName}} готов к выдаче." +
      "{{#publicPhone}}\nЕсли нужно уточнить детали, позвоните: {{publicPhone}}.{{/publicPhone}}",
    active: false,
  },
  {
    key: "precheck-sent",
    name: "Предчек",
    eventType: "precheck_sent",
    body:
      "{{#clientName}}{{clientName}}, {{/clientName}}подготовили предчек по визиту." +
      "{{#precheckUrl}}\nОткрыть предчек: {{precheckUrl}}{{/precheckUrl}}",
    active: false,
  },
];

const defaultRuleSpecs: Array<{
  key: string;
  eventType: ClientNotificationEventType;
  templateKey: string;
  enabled: boolean;
  timingType: NotificationRuleRow["timingType"];
  offsetMinutes?: number | null;
  conditions?: NotificationConditions;
}> = [
  { key: "appointment-client-created", eventType: "appointment_client_created", templateKey: "appointment-confirm", enabled: true, timingType: "immediate" },
  { key: "appointment-admin-created", eventType: "appointment_admin_created", templateKey: "appointment-admin-confirm", enabled: true, timingType: "immediate" },
  {
    key: "appointment-reminder-3h",
    eventType: "appointment_reminder",
    templateKey: "appointment-reminder",
    enabled: true,
    timingType: "before_appointment",
    offsetMinutes: 180,
    conditions: { ...defaultConditions, doNotSendAtNight: true, minNoticeMinutes: 30 },
  },
  { key: "diagnostic-sent", eventType: "diagnostic_sent", templateKey: "diagnostic-ready", enabled: true, timingType: "immediate" },
  {
    key: "client-arrived",
    eventType: "client_arrived",
    templateKey: "client-arrived",
    enabled: true,
    timingType: "immediate",
    conditions: { ...defaultConditions, arrivalStatuses: ["arrived"] },
  },
  {
    key: "visit-completed",
    eventType: "visit_completed",
    templateKey: "visit-review",
    enabled: false,
    timingType: "immediate",
    offsetMinutes: null,
    conditions: defaultConditions,
  },
  {
    key: "review-after-visit",
    eventType: "review_after_visit",
    templateKey: "visit-review",
    enabled: true,
    timingType: "delayed_after_event",
    offsetMinutes: 360,
    conditions: { ...defaultConditions, reviewDelayMinutes: 360, requireReviewLink: true },
  },
  { key: "appointment-rescheduled", eventType: "appointment_rescheduled", templateKey: "appointment-rescheduled", enabled: false, timingType: "immediate" },
  { key: "appointment-cancelled", eventType: "appointment_cancelled", templateKey: "appointment-cancelled", enabled: false, timingType: "immediate" },
  { key: "appointment-no-show", eventType: "appointment_no_show", templateKey: "appointment-no-show", enabled: false, timingType: "immediate" },
  { key: "vehicle-ready", eventType: "vehicle_ready", templateKey: "vehicle-ready", enabled: false, timingType: "immediate" },
  { key: "precheck-sent", eventType: "precheck_sent", templateKey: "precheck-sent", enabled: false, timingType: "immediate" },
];

function orgScopedId(organizationId: string, type: "tpl" | "rule", key: string) {
  return `${organizationId}:${type}:${key}`;
}

function json(value: unknown) {
  return JSON.stringify(value ?? {});
}

function dateIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function reviewDelayHoursValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(168, Math.trunc(parsed)));
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function sanitizeClientNotificationSettings(
  value: unknown,
  fallback: ClientNotificationSettings = defaultClientNotificationSettings
): ClientNotificationSettings {
  const record = asRecord(value);
  return {
    locationAddress: stringValue(record.locationAddress) || fallback.locationAddress || defaultClientNotificationSettings.locationAddress,
    routeSchemeUrl: stringValue(record.routeSchemeUrl) || fallback.routeSchemeUrl,
    routeSchemeImageUrl: stringValue(record.routeSchemeImageUrl) || fallback.routeSchemeImageUrl,
    routeSchemeCaption: stringValue(record.routeSchemeCaption) || fallback.routeSchemeCaption,
    yandexMapsUrl: stringValue(record.yandexMapsUrl) || fallback.yandexMapsUrl,
    yandexReviewUrl: stringValue(record.yandexReviewUrl) || fallback.yandexReviewUrl,
    waitingAreaText: stringValue(record.waitingAreaText) || fallback.waitingAreaText,
    coffeeTeaText: stringValue(record.coffeeTeaText) || fallback.coffeeTeaText,
    receptionManagerText: stringValue(record.receptionManagerText) || fallback.receptionManagerText,
    wifiName: stringValue(record.wifiName) || fallback.wifiName,
    wifiPassword: stringValue(record.wifiPassword) || fallback.wifiPassword,
    postVisitReviewEnabled: booleanValue(record.postVisitReviewEnabled, fallback.postVisitReviewEnabled),
    reviewDelayHours: reviewDelayHoursValue(record.reviewDelayHours, fallback.reviewDelayHours),
    sendReviewOnlyIfShipmentCompleted: booleanValue(record.sendReviewOnlyIfShipmentCompleted, fallback.sendReviewOnlyIfShipmentCompleted),
  };
}

async function loadClientNotificationSettingsInternal(organizationId = getMessengerOrganizationId()) {
  const rows = await prisma.$queryRaw<NotificationSettingsRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      settings_json AS "settingsJson",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM notification_settings
    WHERE organization_id = ${organizationId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return sanitizeClientNotificationSettings(rows[0]?.settingsJson);
}

function enrichContextWithClientNotificationSettings(input: NotificationEventContext, settings: ClientNotificationSettings): NotificationEventContext {
  const payload = asRecord(input.payload);
  const routeSchemeUrl =
    stringValue(input.routeSchemeUrl) ||
    stringValue(payload.routeSchemeUrl) ||
    settings.routeSchemeUrl ||
    settings.routeSchemeImageUrl;
  const yandexMapsUrl = stringValue(input.yandexMapsUrl) || stringValue(payload.yandexMapsUrl) || settings.yandexMapsUrl;
  const yandexReviewUrl = stringValue(input.yandexReviewUrl) || stringValue(payload.yandexReviewUrl) || settings.yandexReviewUrl;
  return {
    ...input,
    locationAddress: stringValue(input.locationAddress) || stringValue(input.address) || settings.locationAddress,
    routeSchemeUrl,
    routeSchemeImageUrl: stringValue(input.routeSchemeImageUrl) || stringValue(payload.routeSchemeImageUrl) || settings.routeSchemeImageUrl,
    routeSchemeCaption: stringValue(input.routeSchemeCaption) || stringValue(payload.routeSchemeCaption) || settings.routeSchemeCaption,
    yandexMapsUrl,
    yandexReviewUrl,
    waitingAreaText: stringValue(input.waitingAreaText) || stringValue(payload.waitingAreaText) || settings.waitingAreaText,
    coffeeTeaText: stringValue(input.coffeeTeaText) || stringValue(payload.coffeeTeaText) || settings.coffeeTeaText,
    receptionManagerText: stringValue(input.receptionManagerText) || stringValue(payload.receptionManagerText) || settings.receptionManagerText,
    wifiName: stringValue(input.wifiName) || stringValue(payload.wifiName) || settings.wifiName,
    wifiPassword: stringValue(input.wifiPassword) || stringValue(payload.wifiPassword) || settings.wifiPassword,
    reviewLink: stringValue(input.reviewLink) || yandexReviewUrl || yandexMapsUrl,
    payload: { ...payload, notificationSettings: settings },
  };
}

function extractTemplateVariables(body: string) {
  const keys = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*[#^/]?\s*([a-zA-Z0-9_]+)|\{\s*([a-zA-Z0-9_]+)/g)) {
    const rawKey = match[1] || match[2];
    const key = canonicalVariableKey(rawKey);
    if (key) keys.add(key);
  }
  return [...keys];
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapTemplate(row: NotificationTemplateRow) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRule(row: NotificationRuleRow) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapJob(row: NotificationJobRow) {
  return {
    ...row,
    scheduledAt: row.scheduledAt.toISOString(),
    nextAttemptAt: dateIso(row.nextAttemptAt),
    sentAt: dateIso(row.sentAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapLog(row: NotificationLogRow) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ensureClientNotificationsSchema() {
  if (!schemaState.__clientNotificationsSchemaPromise) {
    schemaState.__clientNotificationsSchemaPromise = (async () => {
      await ensureMessengerIntegrationCoreSchema();
      const organizationId = getMessengerOrganizationId();

      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS notification_templates (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          name TEXT NOT NULL,
          event_type TEXT NOT NULL,
          channel TEXT NOT NULL,
          body TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          branch_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS notification_rules (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          event_type TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          channel TEXT NOT NULL,
          template_id TEXT NOT NULL,
          timing_type TEXT NOT NULL DEFAULT 'immediate',
          offset_minutes INTEGER,
          conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          branch_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS notification_jobs (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          event_type TEXT NOT NULL,
          channel TEXT NOT NULL,
          client_id TEXT,
          appointment_id TEXT,
          diagnostic_report_id TEXT,
          template_id TEXT NOT NULL,
          scheduled_at TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          idempotency_key TEXT NOT NULL,
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          error_message TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TIMESTAMPTZ,
          sent_at TIMESTAMPTZ,
          provider_message_id TEXT,
          messenger_message_id TEXT,
          messenger_outbox_id TEXT,
          conversation_id TEXT,
          branch_id TEXT,
          initiated_by_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS notification_logs (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          notification_job_id TEXT,
          event_type TEXT NOT NULL,
          channel TEXT NOT NULL,
          client_id TEXT,
          appointment_id TEXT,
          diagnostic_report_id TEXT,
          template_id TEXT,
          status TEXT NOT NULL,
          rendered_message TEXT,
          error_message TEXT,
          provider_message_id TEXT,
          initiated_by_id TEXT,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS client_notification_preferences (
          client_id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          telegram_enabled BOOLEAN NOT NULL DEFAULT true,
          consent_status TEXT NOT NULL DEFAULT 'unknown',
          consent_source TEXT,
          consent_at TIMESTAMPTZ,
          unsubscribed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS notification_settings (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_org_idempotency_uidx ON notification_jobs(organization_id, idempotency_key)`;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS notification_settings_org_uidx ON notification_settings(organization_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_templates_org_event_idx ON notification_templates(organization_id, event_type, channel, is_active)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_rules_org_event_idx ON notification_rules(organization_id, event_type, enabled)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_jobs_org_status_idx ON notification_jobs(organization_id, status, scheduled_at)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_jobs_appointment_idx ON notification_jobs(appointment_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_jobs_diagnostic_idx ON notification_jobs(diagnostic_report_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_logs_org_created_idx ON notification_logs(organization_id, created_at DESC)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_logs_org_event_idx ON notification_logs(organization_id, event_type)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_logs_org_status_idx ON notification_logs(organization_id, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS client_notification_preferences_org_idx ON client_notification_preferences(organization_id, telegram_enabled, consent_status)`;
      await prisma.$executeRaw`
        INSERT INTO notification_settings
          (id, organization_id, settings_json, created_at, updated_at)
        VALUES
          (${`${organizationId}:settings:client-notifications`}, ${organizationId}, ${json(defaultClientNotificationSettings)}::jsonb, now(), now())
        ON CONFLICT (organization_id) DO UPDATE
        SET settings_json = ${json(defaultClientNotificationSettings)}::jsonb || notification_settings.settings_json,
            updated_at = notification_settings.updated_at
      `;

      for (const template of defaultTemplates) {
        const metadata = { systemDefault: true, key: template.key, defaultVersion: 5, variables: extractTemplateVariables(template.body) };
        await prisma.$executeRaw`
          INSERT INTO notification_templates
            (id, organization_id, name, event_type, channel, body, is_active, status, metadata_json, created_at, updated_at)
          VALUES
            (${orgScopedId(organizationId, "tpl", template.key)}, ${organizationId}, ${template.name}, ${template.eventType},
             'telegram', ${template.body}, ${template.active ?? true}, 'active',
             ${json(metadata)}::jsonb, now(), now())
          ON CONFLICT (id) DO NOTHING
        `;
        await prisma.$executeRaw`
          UPDATE notification_templates
          SET name = ${template.name},
              event_type = ${template.eventType},
              body = ${template.body},
              is_active = ${template.active ?? true},
              metadata_json = metadata_json || ${json(metadata)}::jsonb,
              updated_at = now()
          WHERE id = ${orgScopedId(organizationId, "tpl", template.key)}
            AND organization_id = ${organizationId}
            AND metadata_json->>'systemDefault' = 'true'
            AND (
              (
                COALESCE(metadata_json->>'updatedFromSettings', 'false') <> 'true'
                AND COALESCE(metadata_json->>'defaultVersion', '0') <> '5'
              )
              OR body = ${legacyDiagnosticReadyTemplateBody}
              OR body LIKE '%{car}%'
              OR body LIKE '%{{car%'
              OR body LIKE '%Администратор записал вас%'
              OR body LIKE '%Мы отметили ваш приезд%'
            )
        `;
      }

      for (const rule of defaultRuleSpecs) {
        await prisma.$executeRaw`
          INSERT INTO notification_rules
            (id, organization_id, event_type, enabled, channel, template_id, timing_type, offset_minutes, conditions_json, created_at, updated_at)
          VALUES
            (${orgScopedId(organizationId, "rule", rule.key)}, ${organizationId}, ${rule.eventType}, ${rule.enabled}, 'telegram',
             ${orgScopedId(organizationId, "tpl", rule.templateKey)}, ${rule.timingType}, ${rule.offsetMinutes ?? null},
             ${json(rule.conditions ?? defaultConditions)}::jsonb, now(), now())
          ON CONFLICT (id) DO NOTHING
        `;
      }
      await prisma.$executeRaw`
        UPDATE notification_rules
        SET enabled = true,
            conditions_json = ${json({ ...defaultConditions, arrivalStatuses: ["arrived"] })}::jsonb,
            updated_at = now()
        WHERE organization_id = ${organizationId}
          AND id = ${orgScopedId(organizationId, "rule", "client-arrived")}
          AND event_type = 'client_arrived'
      `;
      await prisma.$executeRaw`
        UPDATE notification_rules
        SET enabled = false,
            timing_type = 'immediate',
            offset_minutes = NULL,
            conditions_json = ${json(defaultConditions)}::jsonb,
            updated_at = now()
        WHERE organization_id = ${organizationId}
          AND id = ${orgScopedId(organizationId, "rule", "visit-completed")}
          AND event_type = 'visit_completed'
          AND template_id = ${orgScopedId(organizationId, "tpl", "visit-review")}
      `;
      await prisma.$executeRaw`
        UPDATE notification_rules
        SET enabled = true,
            timing_type = 'delayed_after_event',
            offset_minutes = COALESCE(NULLIF((conditions_json->>'reviewDelayMinutes')::integer, 0), 360),
            conditions_json = conditions_json || ${json({ ...defaultConditions, reviewDelayMinutes: 360, requireReviewLink: true })}::jsonb,
            updated_at = now()
        WHERE organization_id = ${organizationId}
          AND id = ${orgScopedId(organizationId, "rule", "review-after-visit")}
          AND event_type = 'review_after_visit'
      `;
      await repairLegacyCarTemplateErrorJobs(organizationId);
    })().catch((error) => {
      schemaState.__clientNotificationsSchemaPromise = null;
      throw error;
    });
  }
  await schemaState.__clientNotificationsSchemaPromise;
}

async function loadTemplate(templateId: string) {
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<NotificationTemplateRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      name,
      event_type AS "eventType",
      channel,
      body,
      is_active AS "isActive",
      branch_id AS "branchId",
      status,
      metadata_json AS "metadataJson",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM notification_templates
    WHERE organization_id = ${organizationId}
      AND id = ${templateId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function notificationContextFromJobPayload(job: NotificationJobRow, payload: JsonRecord): NotificationEventContext {
  const variables = asRecord(payload.variables);
  const appointmentDateValue = stringValue(variables.appointmentDate) || stringValue(variables.appointment_date);
  const appointmentTimeValue = stringValue(variables.appointmentTime) || stringValue(variables.appointment_time);
  return {
    eventType: job.eventType,
    clientId: job.clientId,
    clientName: stringValue(payload.clientName) || stringValue(variables.clientName) || stringValue(variables.client_name),
    clientPhone: stringValue(payload.clientPhone) || stringValue(variables.clientPhone) || stringValue(variables.client_phone),
    appointmentId: job.appointmentId,
    appointmentAt:
      stringValue(payload.appointmentAt) ||
      stringValue(variables.appointmentDateTime) ||
      stringValue(variables.appointment_datetime) ||
      [appointmentDateValue, appointmentTimeValue].filter(Boolean).join(" "),
    appointmentDate: appointmentDateValue || stringValue(payload.appointmentDate),
    appointmentTime: appointmentTimeValue || stringValue(payload.appointmentTime),
    diagnosticReportId: job.diagnosticReportId,
    diagnosticReportLink:
      stringValue(variables.diagnosticReportUrl) ||
      stringValue(variables.diagnostic_report_link) ||
      stringValue(payload.diagnosticReportLink) ||
      stringValue(payload.reportUrl),
    reviewLink: stringValue(variables.reviewUrl) || stringValue(variables.review_link) || stringValue(payload.reviewLink),
    orderLink: stringValue(variables.orderUrl) || stringValue(variables.order_link) || stringValue(payload.orderLink),
    precheckLink: stringValue(variables.precheckUrl) || stringValue(variables.precheck_link) || stringValue(payload.precheckLink),
    car: stringValue(variables.vehicleDisplayName) || stringValue(variables.car) || stringValue(payload.car),
    carMake: stringValue(variables.vehicleBrand) || stringValue(variables.car_make) || stringValue(payload.carMake),
    carModel: stringValue(variables.vehicleModel) || stringValue(variables.car_model) || stringValue(payload.carModel),
    licensePlate: stringValue(variables.vehiclePlate) || stringValue(variables.license_plate) || stringValue(payload.licensePlate),
    vin: stringValue(variables.vehicleVin) || stringValue(variables.vin) || stringValue(payload.vin),
    serviceList: stringValue(variables.serviceList) || stringValue(variables.service_list) || stringValue(payload.serviceList),
    managerName: stringValue(variables.managerName) || stringValue(variables.manager_name) || stringValue(payload.managerName),
    masterName: stringValue(variables.masterName) || stringValue(variables.master_name) || stringValue(payload.masterName),
    organizationName: stringValue(variables.organizationName) || stringValue(payload.organizationName),
    locationName: stringValue(variables.locationName) || stringValue(variables.branch_name) || stringValue(payload.locationName),
    locationAddress: stringValue(variables.locationAddress) || stringValue(variables.address) || stringValue(payload.locationAddress),
    routeSchemeUrl: stringValue(variables.routeSchemeUrl) || stringValue(variables.route_scheme_url) || stringValue(payload.routeSchemeUrl),
    routeSchemeImageUrl:
      stringValue(variables.routeSchemeImageUrl) || stringValue(variables.route_scheme_image_url) || stringValue(payload.routeSchemeImageUrl),
    routeSchemeCaption:
      stringValue(variables.routeSchemeCaption) || stringValue(variables.route_scheme_caption) || stringValue(payload.routeSchemeCaption),
    yandexMapsUrl: stringValue(variables.yandexMapsUrl) || stringValue(variables.yandex_maps_url) || stringValue(payload.yandexMapsUrl),
    yandexReviewUrl: stringValue(variables.yandexReviewUrl) || stringValue(variables.yandex_review_url) || stringValue(payload.yandexReviewUrl),
    waitingAreaText: stringValue(variables.waitingAreaText) || stringValue(payload.waitingAreaText),
    coffeeTeaText: stringValue(variables.coffeeTeaText) || stringValue(payload.coffeeTeaText),
    receptionManagerText: stringValue(variables.receptionManagerText) || stringValue(payload.receptionManagerText),
    wifiName: stringValue(variables.wifiName) || stringValue(variables.wifi_name) || stringValue(payload.wifiName),
    wifiPassword: stringValue(variables.wifiPassword) || stringValue(variables.wifi_password) || stringValue(payload.wifiPassword),
    publicPhone: stringValue(variables.publicPhone) || stringValue(variables.company_phone) || stringValue(payload.publicPhone),
    telegramUsername: stringValue(variables.telegramUsername) || stringValue(variables.telegram_link) || stringValue(payload.telegramUsername),
    bookingUrl: stringValue(variables.bookingUrl) || stringValue(payload.bookingUrl),
    checkedCount: Number(variables.checkedCount ?? variables.checked_count ?? payload.checkedCount ?? payload.checked_count),
    recommendationCount: Number(variables.recommendationCount ?? variables.recommendation_count ?? payload.recommendationCount ?? payload.recommendation_count),
    criticalCount: Number(variables.criticalCount ?? variables.critical_count ?? payload.criticalCount ?? payload.critical_count),
    warningCount: Number(variables.warningCount ?? variables.warning_count ?? payload.warningCount ?? payload.warning_count),
    branchId: job.branchId,
    initiatedById: job.initiatedById,
    payload,
  };
}

function variablesFromJobPayload(job: NotificationJobRow, payload: JsonRecord) {
  const variables = buildNotificationVariables(notificationContextFromJobPayload(job, payload));
  const storedVariables = asRecord(payload.variables);
  for (const [rawKey, rawValue] of Object.entries(storedVariables)) {
    const value = stringValue(rawValue);
    if (!value) continue;
    if (rawKey === "car") {
      variables.vehicleDisplayName = variables.vehicleDisplayName || value;
      continue;
    }
    const key = canonicalVariableKey(rawKey) ?? rawKey;
    if (supportedVariableSet.has(key)) variables[key] = value;
  }
  for (const [legacyKey, canonicalKey] of legacyVariableAliases) {
    variables[legacyKey] = variables[canonicalKey] ?? "";
  }
  return variables;
}

async function rerenderNotificationJobWithCurrentTemplate(job: NotificationJobRow, payload: JsonRecord) {
  const template = await loadTemplate(job.templateId);
  const fallbackMessage = stringValue(payload.renderedMessage);
  if (!template || !template.isActive || template.status === "draft") {
    return { ok: false as const, renderedMessage: fallbackMessage, errorMessage: "Шаблон отключён или не найден." };
  }
  const variables = variablesFromJobPayload(job, payload);
  const render = renderNotificationTemplate(template.body, variables);
  if (render.unknownVariables.length) {
    return {
      ok: false as const,
      renderedMessage: render.text || fallbackMessage,
      errorMessage: `Неизвестные переменные: ${render.unknownVariables.join(", ")}`,
    };
  }
  if (!render.text) {
    return { ok: false as const, renderedMessage: fallbackMessage, errorMessage: "Пустой текст уведомления." };
  }
  const nextPayload = {
    ...payload,
    variables,
    renderedMessage: render.text,
    missingVariables: render.missingVariables,
    unknownVariables: [],
    templateRepairedAt: new Date().toISOString(),
  };
  await prisma.$executeRaw`
    UPDATE notification_jobs
    SET payload_json = ${json(nextPayload)}::jsonb,
        error_message = NULL,
        updated_at = now()
    WHERE organization_id = ${job.organizationId}
      AND id = ${job.id}
  `;
  return { ok: true as const, payload: nextPayload, renderedMessage: render.text };
}

async function repairLegacyCarTemplateErrorJobs(organizationId: string) {
  const rows = await prisma.$queryRaw<NotificationJobRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      event_type AS "eventType",
      channel,
      client_id AS "clientId",
      appointment_id AS "appointmentId",
      diagnostic_report_id AS "diagnosticReportId",
      template_id AS "templateId",
      scheduled_at AS "scheduledAt",
      status,
      idempotency_key AS "idempotencyKey",
      payload_json AS "payloadJson",
      error_message AS "errorMessage",
      attempts,
      next_attempt_at AS "nextAttemptAt",
      sent_at AS "sentAt",
      provider_message_id AS "providerMessageId",
      messenger_message_id AS "messengerMessageId",
      messenger_outbox_id AS "messengerOutboxId",
      conversation_id AS "conversationId",
      branch_id AS "branchId",
      initiated_by_id AS "initiatedById",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM notification_jobs
    WHERE organization_id = ${organizationId}
      AND status = 'template_error'
      AND (
        COALESCE(error_message, '') ILIKE '%car%'
        OR payload_json::text ILIKE '%car%'
      )
    ORDER BY created_at DESC
    LIMIT 250
  `;

  for (const job of rows) {
    const repaired = await rerenderNotificationJobWithCurrentTemplate(job, asRecord(job.payloadJson));
    if (!repaired.ok) continue;
    const status: NotificationJobStatus = job.scheduledAt <= new Date() ? "queued" : "scheduled";
    await prisma.$executeRaw`
      UPDATE notification_jobs
      SET status = ${status},
          attempts = 0,
          next_attempt_at = NULL,
          error_message = NULL,
          updated_at = now()
      WHERE organization_id = ${organizationId}
        AND id = ${job.id}
        AND status = 'template_error'
    `;
    await writeNotificationLog({
      job,
      eventType: job.eventType,
      status,
      renderedMessage: repaired.renderedMessage,
      errorMessage: "Старый шаблон с {car} автоматически исправлен.",
      metadata: { repair: "legacy_car_template" },
    });
  }
}

async function loadEnabledRules(eventType: ClientNotificationEventType, branchId?: string | null) {
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<NotificationRuleRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      event_type AS "eventType",
      enabled,
      channel,
      template_id AS "templateId",
      timing_type AS "timingType",
      offset_minutes AS "offsetMinutes",
      conditions_json AS "conditionsJson",
      branch_id AS "branchId",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM notification_rules
    WHERE organization_id = ${organizationId}
      AND event_type = ${eventType}
      AND enabled = true
      AND (${branchId ?? null}::text IS NULL OR branch_id IS NULL OR branch_id = ${branchId ?? null})
    ORDER BY branch_id NULLS LAST, offset_minutes NULLS LAST, created_at ASC
  `;
  return rows;
}

function defaultVariableValue(key: string) {
  const canonical = canonicalVariableKey(key) ?? key;
  const defaults: Record<string, string> = {
    clientName: "",
    clientPhone: "",
    appointmentDate: "",
    appointmentTime: "",
    appointmentDateTime: "",
    serviceName: "",
    serviceList: "",
    managerName: "",
    masterName: "",
    vehicleDisplayName: "",
    vehicleBrand: "",
    vehicleModel: "",
    vehiclePlate: "",
    vehicleVin: "",
    organizationName: process.env.NEXT_PUBLIC_SERVICE_NAME?.trim() || process.env.SERVICE_NAME?.trim() || "Там где масло",
    locationName: process.env.NEXT_PUBLIC_BRANCH_NAME?.trim() || process.env.BRANCH_NAME?.trim() || "",
    locationAddress: process.env.NEXT_PUBLIC_SERVICE_ADDRESS?.trim() || process.env.SERVICE_ADDRESS?.trim() || defaultClientNotificationSettings.locationAddress,
    routeSchemeUrl: process.env.NEXT_PUBLIC_ROUTE_SCHEME_URL?.trim() || process.env.ROUTE_SCHEME_URL?.trim() || "",
    routeSchemeImageUrl: process.env.NEXT_PUBLIC_ROUTE_SCHEME_IMAGE_URL?.trim() || process.env.ROUTE_SCHEME_IMAGE_URL?.trim() || "",
    routeSchemeCaption: "",
    yandexMapsUrl: process.env.NEXT_PUBLIC_YANDEX_MAPS_URL?.trim() || process.env.YANDEX_MAPS_URL?.trim() || "",
    yandexReviewUrl: process.env.NEXT_PUBLIC_YANDEX_REVIEW_URL?.trim() || process.env.YANDEX_REVIEW_URL?.trim() || "",
    waitingAreaText: defaultClientNotificationSettings.waitingAreaText,
    coffeeTeaText: defaultClientNotificationSettings.coffeeTeaText,
    receptionManagerText: defaultClientNotificationSettings.receptionManagerText,
    wifiName: "",
    wifiPassword: "",
    publicPhone: process.env.NEXT_PUBLIC_COMPANY_PHONE?.trim() || process.env.COMPANY_PHONE?.trim() || "",
    telegramUsername: process.env.NEXT_PUBLIC_TELEGRAM_LINK?.trim() || process.env.TELEGRAM_LINK?.trim() || "",
    bookingUrl: process.env.NEXT_PUBLIC_BOOKING_URL?.trim() || process.env.BOOKING_URL?.trim() || "",
    diagnosticReportUrl: "",
    reviewUrl:
      process.env.NEXT_PUBLIC_REVIEW_LINK?.trim() ||
      process.env.REVIEW_LINK?.trim() ||
      process.env.NEXT_PUBLIC_YANDEX_REVIEW_URL?.trim() ||
      process.env.YANDEX_REVIEW_URL?.trim() ||
      process.env.NEXT_PUBLIC_YANDEX_MAPS_URL?.trim() ||
      process.env.YANDEX_MAPS_URL?.trim() ||
      "",
    orderUrl: "",
    precheckUrl: "",
    checkedCount: "0",
    recommendationCount: "0",
    criticalCount: "0",
    warningCount: "0",
    recommendationText: diagnosticRecommendationText(0),
    criticalText: diagnosticCriticalText(0),
  };
  return defaults[canonical] ?? "";
}

function appointmentDate(input: NotificationEventContext) {
  const parsed = input.appointmentAt ? parseServiceDateTime(input.appointmentAt) : null;
  if (parsed) return parsed;
  const date = stringValue(input.appointmentDate);
  const time = stringValue(input.appointmentTime);
  if (date && time) return parseServiceDateTime(`${date} ${time}`);
  return null;
}

export function buildNotificationVariables(input: NotificationEventContext): Record<string, string> {
  const at = appointmentDate(input);
  const vehicleDisplayName =
    stringValue(input.car) ||
    [input.carMake, input.carModel, input.licensePlate || input.vin].map(stringValue).filter(Boolean).join(" · ");
  const payload = asRecord(input.payload);
  const settings = sanitizeClientNotificationSettings(payload.notificationSettings);
  const criticalCount = nonNegativeCount(input.criticalCount ?? payload.criticalCount ?? payload.critical_count);
  const warningCount = nonNegativeCount(input.warningCount ?? payload.warningCount ?? payload.warning_count);
  const recommendationCount = nonNegativeCount(
    input.recommendationCount ?? payload.recommendationCount ?? payload.recommendation_count ?? warningCount
  );
  const checkedCount = nonNegativeCount(input.checkedCount ?? payload.checkedCount ?? payload.checked_count ?? payload.totalCount ?? payload.total_count);
  const serviceList = stringValue(input.serviceList);
  const yandexMapsUrl = stringValue(input.yandexMapsUrl) || stringValue(payload.yandexMapsUrl) || settings.yandexMapsUrl || defaultVariableValue("yandexMapsUrl");
  const yandexReviewUrl =
    stringValue(input.yandexReviewUrl) || stringValue(payload.yandexReviewUrl) || settings.yandexReviewUrl || defaultVariableValue("yandexReviewUrl");
  const routeSchemeUrl =
    stringValue(input.routeSchemeUrl) ||
    stringValue(payload.routeSchemeUrl) ||
    settings.routeSchemeUrl ||
    settings.routeSchemeImageUrl ||
    defaultVariableValue("routeSchemeUrl");
  const values: Record<string, string> = {
    clientName: stringValue(input.clientName),
    clientPhone: stringValue(input.clientPhone),
    organizationName: stringValue(input.organizationName) || defaultVariableValue("organizationName"),
    locationName: stringValue(input.locationName) || stringValue(input.branchName) || defaultVariableValue("locationName"),
    locationAddress: stringValue(input.locationAddress) || stringValue(input.address) || settings.locationAddress || defaultVariableValue("locationAddress"),
    routeSchemeUrl,
    routeSchemeImageUrl:
      stringValue(input.routeSchemeImageUrl) || stringValue(payload.routeSchemeImageUrl) || settings.routeSchemeImageUrl || defaultVariableValue("routeSchemeImageUrl"),
    routeSchemeCaption:
      stringValue(input.routeSchemeCaption) || stringValue(payload.routeSchemeCaption) || settings.routeSchemeCaption || defaultVariableValue("routeSchemeCaption"),
    yandexMapsUrl,
    yandexReviewUrl,
    waitingAreaText: stringValue(input.waitingAreaText) || stringValue(payload.waitingAreaText) || settings.waitingAreaText,
    coffeeTeaText: stringValue(input.coffeeTeaText) || stringValue(payload.coffeeTeaText) || settings.coffeeTeaText,
    receptionManagerText: stringValue(input.receptionManagerText) || stringValue(payload.receptionManagerText) || settings.receptionManagerText,
    wifiName: stringValue(input.wifiName) || stringValue(payload.wifiName) || settings.wifiName,
    wifiPassword: stringValue(input.wifiPassword) || stringValue(payload.wifiPassword) || settings.wifiPassword,
    appointmentDate: at ? formatServiceDate(at) : stringValue(input.appointmentDate),
    appointmentTime: at ? formatServiceTime(at) : stringValue(input.appointmentTime),
    appointmentDateTime: at ? formatServiceDateTime(at) : [input.appointmentDate, input.appointmentTime].map(stringValue).filter(Boolean).join(" "),
    vehicleDisplayName,
    vehicleBrand: stringValue(input.carMake),
    vehicleModel: stringValue(input.carModel),
    vehiclePlate: stringValue(input.licensePlate),
    vehicleVin: stringValue(input.vin),
    serviceName: serviceList,
    serviceList,
    managerName: stringValue(input.managerName),
    masterName: stringValue(input.masterName),
    diagnosticReportUrl: stringValue(input.diagnosticReportLink),
    reviewUrl: stringValue(input.reviewLink) || yandexReviewUrl || yandexMapsUrl || defaultVariableValue("reviewUrl"),
    orderUrl: stringValue(input.orderLink),
    precheckUrl: stringValue(input.precheckLink),
    publicPhone: stringValue(input.publicPhone) || stringValue(input.companyPhone) || defaultVariableValue("publicPhone"),
    telegramUsername: stringValue(input.telegramUsername) || stringValue(input.telegramLink) || defaultVariableValue("telegramUsername"),
    bookingUrl: stringValue(input.bookingUrl) || defaultVariableValue("bookingUrl"),
    checkedCount: String(checkedCount),
    recommendationCount: String(recommendationCount),
    criticalCount: String(criticalCount),
    warningCount: String(warningCount),
    recommendationText: diagnosticRecommendationText(recommendationCount),
    criticalText: diagnosticCriticalText(criticalCount),
  };

  for (const definition of notificationVariableDefinitions) {
    values[definition.key] = values[definition.key] || defaultVariableValue(definition.key);
  }
  for (const [legacyKey, canonicalKey] of legacyVariableAliases) {
    values[legacyKey] = values[canonicalKey] ?? "";
  }
  return values;
}

export function renderNotificationTemplate(body: string, variables: Record<string, string>): RenderResult {
  const unknownVariables = new Set<string>();
  const missingVariables = new Set<string>();
  const usedVariables: Record<string, string> = {};
  const usedVariableKeys = new Set<string>();
  const optionalLineVariables = new Set([
    "locationAddress",
    "routeSchemeUrl",
    "routeSchemeImageUrl",
    "routeSchemeCaption",
    "yandexMapsUrl",
    "yandexReviewUrl",
    "waitingAreaText",
    "coffeeTeaText",
    "receptionManagerText",
    "wifiName",
    "wifiPassword",
    "reviewUrl",
    "orderUrl",
    "precheckUrl",
    "telegramUsername",
    "publicPhone",
    "diagnosticReportUrl",
    "bookingUrl",
    "vehicleDisplayName",
    "serviceName",
    "serviceList",
    "managerName",
    "masterName",
  ]);
  const tokenPattern = /\{\{\s*([a-zA-Z0-9_]+)(?:\|([^}]+))?\s*\}\}|\{\s*([a-zA-Z0-9_]+)(?:\|([^}]+))?\s*\}/g;
  const sectionPattern = /\{\{\s*([#^])\s*([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/g;

  const renderSections = (text: string) => {
    let current = text;
    let previous = "";
    while (current !== previous) {
      previous = current;
      current = current.replace(sectionPattern, (_match, mode: string, rawKey: string, content: string) => {
        const key = canonicalVariableKey(rawKey);
        if (!key) {
          unknownVariables.add(rawKey);
          return "";
        }
        usedVariableKeys.add(key);
        const value = stringValue(variables[key]);
        if (value) usedVariables[key] = value;
        const shouldRender = mode === "#" ? Boolean(value) : !value;
        return shouldRender ? content : "";
      });
    }
    return current;
  };

  const lines = renderSections(body).split(/\r?\n/).map((line) => {
    const missingInLine = new Set<string>();
    const variablesInLine = new Set<string>();
    const rendered = line.replace(tokenPattern, (_match, doubleKey: string, doubleFallback: string, singleKey: string, singleFallback: string) => {
      const rawKey = doubleKey || singleKey;
      const key = canonicalVariableKey(rawKey);
      const fallback = doubleFallback ?? singleFallback;
      if (!key) {
        unknownVariables.add(rawKey);
        return `{${rawKey}}`;
      }
      variablesInLine.add(key);
      usedVariableKeys.add(key);
      const value = stringValue(variables[key]);
      const replacement = value || stringValue(fallback) || defaultVariableValue(key);
      if (!replacement) {
        missingVariables.add(key);
        missingInLine.add(key);
      }
      usedVariables[key] = replacement;
      return replacement;
    });

    const onlyMissingOptionalVariables =
      variablesInLine.size > 0 &&
      [...variablesInLine].every((key) => optionalLineVariables.has(key)) &&
      [...missingInLine].some((key) => optionalLineVariables.has(key));
    if (onlyMissingOptionalVariables) return null;

    const cleaned = [...missingInLine].reduce((text, key) => {
      if (key !== "locationAddress") return text;
      return text
        .replace(/\s*(?:Адрес|Адрес сервиса):\s*(?=[.!?]|$)/giu, "")
        .replace(/\s*по адресу:\s*(?=[.!?]|$)/giu, "");
    }, rendered);
    return cleaned
      .replace(/[ \t]+/g, " ")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/([.!?]){2,}/g, "$1")
      .trim();
  });

  return {
    text: lines.filter((line): line is string => line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    variables: usedVariables,
    missingVariables: [...missingVariables],
    unknownVariables: [...unknownVariables],
    variableDetails: notificationVariableDefinitions.map((definition) => {
      const value = stringValue(variables[definition.key]);
      const used = usedVariableKeys.has(definition.key);
      return {
        ...definition,
        value,
        used,
        missing: used && !value,
      };
    }),
  };
}

export function sampleNotificationContext(overrides: NotificationEventContext = {}): NotificationEventContext {
  return {
    clientName: "Максим",
    clientPhone: "+7 911 000-12-34",
    appointmentId: "A-461",
    appointmentAt: "2026-07-03 15:00",
    car: "BMW X5 · A123BC",
    carMake: "BMW",
    carModel: "X5",
    licensePlate: "A123BC",
    vin: "WBABA91070AL55203",
    serviceList: "Замена масла + диагностика",
    managerName: "Вадим",
    masterName: "Денис",
    branchName: defaultVariableValue("locationName") || "Основной сервис",
    address: defaultVariableValue("locationAddress") || "Калининград, ул. Дачная, 6В",
    companyPhone: defaultVariableValue("publicPhone") || "+7 4012 00-00-00",
    routeSchemeUrl: defaultVariableValue("routeSchemeUrl") || "https://example.com/route",
    routeSchemeCaption: "Заезд со стороны ул. Дачной.",
    yandexMapsUrl: defaultVariableValue("yandexMapsUrl") || "https://yandex.ru/maps/-/demo",
    yandexReviewUrl: defaultVariableValue("yandexReviewUrl") || "https://yandex.ru/maps/org/demo/reviews",
    waitingAreaText: defaultClientNotificationSettings.waitingAreaText,
    coffeeTeaText: defaultClientNotificationSettings.coffeeTeaText,
    receptionManagerText: defaultClientNotificationSettings.receptionManagerText,
    wifiName: "TGM Guest",
    wifiPassword: "oil2026",
    diagnosticReportLink: "https://example.com/report/demo",
    reviewLink: defaultVariableValue("reviewUrl") || "https://yandex.ru/maps/org/demo/reviews",
    orderLink: "https://example.com/order/demo",
    precheckLink: "https://example.com/precheck/demo",
    telegramLink: defaultVariableValue("telegramUsername") || "https://t.me/tam_gde_maslo",
    criticalCount: 1,
    warningCount: 3,
    ...overrides,
  };
}

export async function previewNotificationTemplate(templateIdOrBody: string, context: NotificationEventContext = {}) {
  await ensureClientNotificationsSchema();
  const template = templateIdOrBody.includes("{") || templateIdOrBody.includes("\n") ? null : await loadTemplate(templateIdOrBody);
  const body = template?.body ?? templateIdOrBody;
  const settings = await loadClientNotificationSettingsInternal();
  const variables = buildNotificationVariables(enrichContextWithClientNotificationSettings(sampleNotificationContext(context), settings));
  return renderNotificationTemplate(body, variables);
}

async function resolveLocalCounterparty(clientId: string | null, phone: string | null) {
  if (clientId) {
    const rows = await prisma.$queryRaw<NotificationCounterpartyRow[]>`
      SELECT id, name, phone, normalized_phone AS "normalizedPhone"
      FROM local_counterparties
      WHERE id = ${clientId}
         OR moysklad_id = ${clientId}
      ORDER BY CASE WHEN id = ${clientId} THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }
  if (!phone) return null;
  const rows = await prisma.$queryRaw<NotificationCounterpartyRow[]>`
    SELECT id, name, phone, normalized_phone AS "normalizedPhone"
    FROM local_counterparties
    WHERE normalized_phone = ${phone}
       OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phone}
       OR (
         length(${phone}::text) >= 10
         AND (
           right(COALESCE(normalized_phone, ''), 10) = right(${phone}::text, 10)
           OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone}::text, 10)
         )
       )
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function resolveClientIdentity(input: NotificationEventContext) {
  const phone = normalizePhoneKey(input.clientPhone);
  let clientId = nullableString(input.clientId);
  let clientName = nullableString(input.clientName);
  let clientPhone = nullableString(input.clientPhone);
  const counterparty = await resolveLocalCounterparty(clientId, phone);
  if (counterparty) {
    clientId = counterparty.id;
    clientName = clientName ?? counterparty.name;
    clientPhone = clientPhone ?? counterparty.phone ?? counterparty.normalizedPhone;
  }
  return { clientId, clientName, clientPhone };
}

function messengerAccountIdFromExternalChatId(externalChatId: string) {
  return externalChatId.match(/^telegram:user:([^:]+):/)?.[1] ?? null;
}

async function findTelegramConnectionTarget(clientId: string | null, phone: string | null) {
  if (!clientId && !phone) return null;
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<TelegramConnectionTarget[]>`
    SELECT
      id,
      external_chat_id AS "externalChatId",
      display_name AS "displayName",
      phone,
      client_id AS "clientId"
    FROM messenger_connections
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND type = 'client'
      AND is_active = true
      AND blocked_at IS NULL
      AND (
        (${clientId ?? null}::text IS NOT NULL AND client_id = ${clientId ?? null})
        OR (${phone ?? null}::text IS NOT NULL AND ${phone ?? null}::text <> '' AND (
          regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phone ?? null}
          OR (
            length(${phone ?? null}::text) >= 10
            AND right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone ?? null}::text, 10)
          )
        ))
      )
    ORDER BY
      CASE WHEN ${clientId ?? null}::text IS NOT NULL AND client_id = ${clientId ?? null} THEN 0 ELSE 1 END,
      linked_at DESC NULLS LAST,
      updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function upsertTelegramConversationFromConnection(input: {
  connection: TelegramConnectionTarget;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  diagnosticReportId?: string | null;
  appointmentId?: string | null;
  payload?: JsonRecord | null;
}) {
  const id = crypto.randomUUID();
  const organizationId = getMessengerOrganizationId();
  const title = input.clientName || input.connection.displayName || "Telegram";
  const messengerAccountId = messengerAccountIdFromExternalChatId(input.connection.externalChatId);
  const rows = await prisma.$queryRaw<ConversationTarget[]>`
    INSERT INTO messenger_conversations
      (id, organization_id, messenger_account_id, channel, external_conversation_id, external_chat_id, connection_id, client_id,
       title, participant_name, participant_phone, status, unread_count, last_message_text, last_message_at,
       related_diagnostic_id, related_appointment_id, related_shipment_id, updated_at)
    VALUES
      (${id}, ${organizationId}, ${messengerAccountId}, 'telegram', ${input.connection.externalChatId}, ${input.connection.externalChatId},
       ${input.connection.id}, ${input.clientId}, ${title}, ${title}, ${input.clientPhone ?? input.connection.phone}, 'open', 0, '', now(),
       ${input.diagnosticReportId ?? null}, ${input.appointmentId ?? null}, ${stringValue(input.payload?.shipmentId) || null}, now())
    ON CONFLICT (channel, external_conversation_id)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      messenger_account_id = COALESCE(EXCLUDED.messenger_account_id, messenger_conversations.messenger_account_id),
      external_chat_id = COALESCE(EXCLUDED.external_chat_id, messenger_conversations.external_chat_id),
      connection_id = EXCLUDED.connection_id,
      client_id = COALESCE(EXCLUDED.client_id, messenger_conversations.client_id),
      title = COALESCE(NULLIF(EXCLUDED.title, ''), messenger_conversations.title),
      participant_name = COALESCE(NULLIF(EXCLUDED.participant_name, ''), messenger_conversations.participant_name),
      participant_phone = COALESCE(EXCLUDED.participant_phone, messenger_conversations.participant_phone),
      related_diagnostic_id = COALESCE(EXCLUDED.related_diagnostic_id, messenger_conversations.related_diagnostic_id),
      related_appointment_id = COALESCE(EXCLUDED.related_appointment_id, messenger_conversations.related_appointment_id),
      related_shipment_id = COALESCE(EXCLUDED.related_shipment_id, messenger_conversations.related_shipment_id),
      status = 'open',
      updated_at = now()
    RETURNING
      id,
      external_conversation_id AS "externalConversationId",
      messenger_account_id AS "messengerAccountId",
      client_id AS "clientId"
  `;
  return rows[0] ?? {
    id,
    externalConversationId: input.connection.externalChatId,
    messengerAccountId,
    clientId: input.clientId,
  };
}

async function findTelegramConversation(input: NotificationEventContext): Promise<ConversationTarget | null> {
  const organizationId = getMessengerOrganizationId();
  const resolved = await resolveClientIdentity(input);
  const clientId = resolved.clientId;
  const phone = normalizePhoneKey(resolved.clientPhone ?? input.clientPhone);
  const explicitChatId = stringValue(input.payload?.telegramId);
  const normalizedChat = explicitChatId ? (explicitChatId.startsWith("telegram:") ? explicitChatId : `telegram:${explicitChatId}`) : "";

  const rows = await prisma.$queryRaw<ConversationTarget[]>`
    SELECT
      mc.id,
      mc.external_conversation_id AS "externalConversationId",
      mc.messenger_account_id AS "messengerAccountId",
      mc.client_id AS "clientId"
    FROM messenger_conversations mc
    LEFT JOIN communication_identities ci
      ON ci.organization_id = mc.organization_id
      AND ci.channel = 'telegram'
      AND ci.status <> 'UNLINKED'
      AND (
        ci.external_conversation_id = mc.external_conversation_id
        OR (ci.external_user_id IS NOT NULL AND ci.external_user_id = mc.external_user_id)
      )
    LEFT JOIN local_counterparties conversation_client
      ON conversation_client.id = mc.client_id OR conversation_client.moysklad_id = mc.client_id
    LEFT JOIN local_counterparties conversation_supplier
      ON conversation_supplier.id = mc.supplier_id OR conversation_supplier.moysklad_id = mc.supplier_id
    WHERE mc.organization_id = ${organizationId}
      AND mc.channel = 'telegram'
      AND mc.status <> 'archived'
      AND (
        (${normalizedChat}::text <> '' AND mc.external_conversation_id = ${normalizedChat})
        OR (${clientId ?? null}::text IS NOT NULL AND (
          mc.client_id = ${clientId ?? null}
          OR mc.supplier_id = ${clientId ?? null}
          OR ci.client_id = ${clientId ?? null}
          OR ci.supplier_id = ${clientId ?? null}
          OR conversation_client.id = ${clientId ?? null}
          OR conversation_client.moysklad_id = ${clientId ?? null}
          OR conversation_supplier.id = ${clientId ?? null}
          OR conversation_supplier.moysklad_id = ${clientId ?? null}
        ))
        OR (${phone}::text IS NOT NULL AND ${phone}::text <> '' AND (
          regexp_replace(COALESCE(mc.participant_phone, ''), '[^0-9]', '', 'g') = ${phone}
          OR ci.phone_normalized = ${phone}
          OR conversation_client.normalized_phone = ${phone}
          OR conversation_supplier.normalized_phone = ${phone}
          OR (
            length(${phone}::text) >= 10
            AND (
              right(regexp_replace(COALESCE(mc.participant_phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone}::text, 10)
              OR right(COALESCE(ci.phone_normalized, ''), 10) = right(${phone}::text, 10)
              OR right(COALESCE(conversation_client.normalized_phone, ''), 10) = right(${phone}::text, 10)
              OR right(regexp_replace(COALESCE(conversation_client.phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone}::text, 10)
              OR right(COALESCE(conversation_supplier.normalized_phone, ''), 10) = right(${phone}::text, 10)
              OR right(regexp_replace(COALESCE(conversation_supplier.phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone}::text, 10)
            )
          )
        ))
      )
      AND (
        mc.messenger_account_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM messenger_accounts ma
          WHERE ma.id = mc.messenger_account_id
            AND ma.organization_id = ${organizationId}
            AND ma.channel = 'telegram'
            AND ma.is_active = true
            AND ma.status = 'connected'
        )
      )
    ORDER BY
      CASE
        WHEN ${clientId ?? null}::text IS NOT NULL AND (
          mc.client_id = ${clientId ?? null}
          OR mc.supplier_id = ${clientId ?? null}
          OR conversation_client.id = ${clientId ?? null}
          OR conversation_client.moysklad_id = ${clientId ?? null}
          OR conversation_supplier.id = ${clientId ?? null}
          OR conversation_supplier.moysklad_id = ${clientId ?? null}
        ) THEN 0
        ELSE 1
      END,
      CASE
        WHEN ${phone}::text IS NOT NULL AND ${phone}::text <> '' AND (
          regexp_replace(COALESCE(mc.participant_phone, ''), '[^0-9]', '', 'g') = ${phone}
          OR ci.phone_normalized = ${phone}
          OR conversation_client.normalized_phone = ${phone}
          OR conversation_supplier.normalized_phone = ${phone}
          OR (
            length(${phone}::text) >= 10
            AND (
              right(regexp_replace(COALESCE(mc.participant_phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone}::text, 10)
              OR right(COALESCE(ci.phone_normalized, ''), 10) = right(${phone}::text, 10)
              OR right(COALESCE(conversation_client.normalized_phone, ''), 10) = right(${phone}::text, 10)
              OR right(regexp_replace(COALESCE(conversation_client.phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone}::text, 10)
              OR right(COALESCE(conversation_supplier.normalized_phone, ''), 10) = right(${phone}::text, 10)
              OR right(regexp_replace(COALESCE(conversation_supplier.phone, ''), '[^0-9]', '', 'g'), 10) = right(${phone}::text, 10)
            )
          )
        ) THEN 0
        ELSE 1
      END,
      mc.last_message_at DESC
    LIMIT 1
  `;
  if (rows[0]) return rows[0];

  const connection = await findTelegramConnectionTarget(clientId, phone);
  return connection
    ? upsertTelegramConversationFromConnection({
        connection,
        clientId,
        clientName: resolved.clientName,
        clientPhone: resolved.clientPhone,
        diagnosticReportId: input.diagnosticReportId,
        appointmentId: input.appointmentId,
        payload: input.payload,
      })
    : startTelegramConversationFromContact(input, resolved);
}

async function startTelegramConversationFromContact(
  input: NotificationEventContext,
  resolved: { clientId: string | null; clientName: string | null; clientPhone: string | null }
): Promise<ConversationTarget | null> {
  if (!resolved.clientId && !resolved.clientPhone && !input.clientPhone) return null;
  try {
    const started = await startContactConversation({
      entityType: "counterparty",
      entityId: resolved.clientId,
      counterpartyId: resolved.clientId,
      clientId: resolved.clientId,
      phone: resolved.clientPhone ?? input.clientPhone ?? null,
      displayName: resolved.clientName ?? input.clientName ?? null,
      preferredChannel: "telegram",
      context: {
        entityType: input.diagnosticReportId ? "diagnostic" : input.appointmentId ? "appointment" : "client",
        entityId: input.diagnosticReportId ?? input.appointmentId ?? resolved.clientId,
        shipmentId: stringValue(input.payload?.shipmentId),
        appointmentId: input.appointmentId ?? null,
        diagnosticId: input.diagnosticReportId ?? null,
        reportToken: stringValue(input.payload?.reportToken),
        car: input.car ?? null,
        plate: input.licensePlate ?? null,
        link: input.diagnosticReportLink ?? input.precheckLink ?? input.orderLink ?? null,
      },
    });
    if (!started?.conversationId) return null;
    return {
      id: started.conversationId,
      externalConversationId: "",
      messengerAccountId: null,
      clientId: resolved.clientId,
    };
  } catch {
    return null;
  }
}

async function clientConsentBlocked(clientId: string | null) {
  if (!clientId) return false;
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<Array<{ telegramEnabled: boolean; consentStatus: string; unsubscribedAt: Date | null }>>`
    SELECT
      telegram_enabled AS "telegramEnabled",
      consent_status AS "consentStatus",
      unsubscribed_at AS "unsubscribedAt"
    FROM client_notification_preferences
    WHERE organization_id = ${organizationId}
      AND client_id = ${clientId}
    LIMIT 1
  `;
  const pref = rows[0];
  if (!pref) return false;
  return !pref.telegramEnabled || Boolean(pref.unsubscribedAt) || ["denied", "revoked", "unsubscribed", "blocked"].includes(pref.consentStatus);
}

function notificationStatusLabel(status: NotificationJobStatus) {
  const labels: Record<NotificationJobStatus, string> = {
    scheduled: "запланировано",
    queued: "в очереди",
    sending: "отправляется",
    sent: "отправлено",
    delivered: "доставлено",
    error: "ошибка",
    cancelled: "отменено",
    skipped: "пропущено",
    client_not_connected: "клиент не подключён",
    no_consent: "нет согласия",
    duplicate_blocked: "дубль заблокирован",
    template_error: "ошибка шаблона",
  };
  return labels[status] ?? status;
}

async function writeNotificationLog(input: {
  job?: Partial<NotificationJobRow> | null;
  eventType: ClientNotificationEventType;
  channel?: string;
  clientId?: string | null;
  appointmentId?: string | null;
  diagnosticReportId?: string | null;
  templateId?: string | null;
  status: NotificationJobStatus;
  renderedMessage?: string | null;
  errorMessage?: string | null;
  providerMessageId?: string | null;
  initiatedById?: string | null;
  metadata?: JsonRecord;
}) {
  const organizationId = getMessengerOrganizationId();
  await prisma.$executeRaw`
    INSERT INTO notification_logs
      (id, organization_id, notification_job_id, event_type, channel, client_id, appointment_id, diagnostic_report_id,
       template_id, status, rendered_message, error_message, provider_message_id, initiated_by_id, metadata_json, created_at)
    VALUES
      (${crypto.randomUUID()}, ${organizationId}, ${input.job?.id ?? null}, ${input.eventType}, ${input.channel ?? input.job?.channel ?? "telegram"},
       ${input.clientId ?? input.job?.clientId ?? null}, ${input.appointmentId ?? input.job?.appointmentId ?? null},
       ${input.diagnosticReportId ?? input.job?.diagnosticReportId ?? null}, ${input.templateId ?? input.job?.templateId ?? null},
       ${input.status}, ${input.renderedMessage ?? null}, ${input.errorMessage ?? null}, ${input.providerMessageId ?? null},
       ${input.initiatedById ?? input.job?.initiatedById ?? null}, ${json(input.metadata ?? {})}::jsonb, now())
  `;
}

function isCancelledContext(input: NotificationEventContext) {
  const status = stringValue(input.status).toLowerCase();
  return Boolean(input.isCancelled) || ["cancelled", "canceled", "deleted", "отменена", "отменено"].includes(status);
}

function isCompletedShipmentPayload(payload: JsonRecord) {
  if (payload.shipmentCompleted === true || payload.orderCompleted === true || payload.visitCompleted === true) return true;
  const status = stringValue(payload.shipmentStatus ?? payload.orderStatus ?? payload.visitStatus).toLowerCase();
  return ["done", "completed", "closed", "shipped", "завершен", "завершён", "закрыт", "закрыта"].includes(status);
}

function scheduledAtForRule(rule: NotificationRuleRow, input: NotificationEventContext) {
  const now = new Date();
  if (rule.timingType === "before_appointment") {
    const at = appointmentDate(input);
    if (!at) return null;
    return new Date(at.getTime() - Math.max(0, rule.offsetMinutes ?? 0) * 60_000);
  }
  if (rule.timingType === "delayed_after_event") {
    return new Date(now.getTime() + Math.max(0, rule.offsetMinutes ?? 0) * 60_000);
  }
  return now;
}

function shouldSkipPastReminder(rule: NotificationRuleRow, input: NotificationEventContext, scheduledAt: Date) {
  if (rule.timingType !== "before_appointment") return null;
  const now = new Date();
  const appointmentAt = appointmentDate(input);
  if (!appointmentAt) return "Не указано время записи.";
  if (appointmentAt <= now) return "Запись уже прошла.";
  if (scheduledAt <= now) return "Время напоминания уже прошло.";
  const minNotice = Math.max(0, numberValue(rule.conditionsJson?.minNoticeMinutes) ?? 0);
  if (appointmentAt.getTime() - now.getTime() < minNotice * 60_000) {
    return `До визита меньше ${minNotice} мин.`;
  }
  return null;
}

function isQuietTime(conditions: NotificationConditions, now = new Date()) {
  if (!conditions.doNotSendAtNight) return false;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: conditions.timezone || SERVICE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const [hourRaw, minuteRaw] = formatter.format(now).split(":");
  const minuteOfDay = Number(hourRaw) * 60 + Number(minuteRaw);
  const [fromH, fromM] = (conditions.quietHours?.from || "22:00").split(":").map(Number);
  const [toH, toM] = (conditions.quietHours?.to || "09:00").split(":").map(Number);
  const from = fromH * 60 + fromM;
  const to = toH * 60 + toM;
  return from <= to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to;
}

function idempotencyKey(rule: NotificationRuleRow, input: NotificationEventContext, clientId: string | null) {
  const eventType = rule.eventType;
  const recipient = clientId ?? normalizePhoneKey(input.clientPhone) ?? "client";
  if (eventType === "diagnostic_sent") {
    const entityId = stringValue(input.diagnosticReportId ?? input.payload?.diagnosticReportId ?? input.appointmentId) || "diagnostic";
    return [eventType, entityId, rule.channel, recipient].join(":");
  }
  if (eventType === "appointment_reminder") {
    const entityId = `${stringValue(input.appointmentId) || "appointment"}:before:${rule.offsetMinutes ?? 0}`;
    return [eventType, entityId, rule.channel, recipient].join(":");
  }
  const entityId = stringValue(input.appointmentId ?? input.diagnosticReportId ?? input.payload?.sourceId) || "entity";
  return [eventType, entityId, rule.channel, recipient].join(":");
}

async function createNotificationJob(rule: NotificationRuleRow, template: NotificationTemplateRow, input: NotificationEventContext) {
  const notificationSettings = await loadClientNotificationSettingsInternal();
  const effectiveInput = enrichContextWithClientNotificationSettings(input, notificationSettings);
  const reviewDelayMinutes = Math.max(0, notificationSettings.reviewDelayHours * 60);
  const effectiveRule: NotificationRuleRow =
    rule.eventType === "review_after_visit"
      ? {
          ...rule,
          offsetMinutes: reviewDelayMinutes,
          conditionsJson: { ...rule.conditionsJson, reviewDelayMinutes, requireReviewLink: true },
        }
      : rule;
  const resolved = await resolveClientIdentity(effectiveInput);
  const clientId = resolved.clientId;
  if (effectiveRule.eventType === "review_after_visit" && !notificationSettings.postVisitReviewEnabled) {
    await writeNotificationLog({
      eventType: effectiveRule.eventType,
      clientId,
      appointmentId: nullableString(effectiveInput.appointmentId),
      diagnosticReportId: nullableString(effectiveInput.diagnosticReportId),
      templateId: template.id,
      status: "skipped",
      errorMessage: "Просьба оставить отзыв выключена в настройках.",
      metadata: { ruleId: effectiveRule.id },
    });
    return { created: false, reason: "review_disabled" as const };
  }
  if (effectiveRule.eventType === "review_after_visit" && notificationSettings.sendReviewOnlyIfShipmentCompleted) {
    const payload = asRecord(effectiveInput.payload);
    if (!isCompletedShipmentPayload(payload)) {
      await writeNotificationLog({
        eventType: effectiveRule.eventType,
        clientId,
        appointmentId: nullableString(effectiveInput.appointmentId),
        diagnosticReportId: nullableString(effectiveInput.diagnosticReportId),
        templateId: template.id,
        status: "skipped",
        errorMessage: "Заказ-наряд ещё не отмечен завершённым.",
        metadata: { ruleId: effectiveRule.id },
      });
      return { created: false, reason: "shipment_not_completed" as const };
    }
  }
  const reviewUrl =
    stringValue(effectiveInput.yandexReviewUrl) ||
    stringValue(effectiveInput.reviewLink) ||
    stringValue(effectiveInput.yandexMapsUrl);
  if ((effectiveRule.conditionsJson?.requireReviewLink || effectiveRule.eventType === "review_after_visit") && !reviewUrl) {
    await writeNotificationLog({
      eventType: effectiveRule.eventType,
      clientId,
      appointmentId: nullableString(effectiveInput.appointmentId),
      diagnosticReportId: nullableString(effectiveInput.diagnosticReportId),
      templateId: template.id,
      status: "skipped",
      errorMessage: "Не указана ссылка Яндекс.Карт или ссылка для отзыва.",
      metadata: { ruleId: effectiveRule.id },
    });
    return { created: false, reason: "missing_review_link" as const };
  }
  const scheduledAt = scheduledAtForRule(effectiveRule, effectiveInput);
  if (!scheduledAt) {
    await writeNotificationLog({
      eventType: effectiveRule.eventType,
      clientId,
      appointmentId: nullableString(effectiveInput.appointmentId),
      diagnosticReportId: nullableString(effectiveInput.diagnosticReportId),
      templateId: template.id,
      status: "skipped",
      errorMessage: "Не удалось определить время отправки.",
      metadata: { ruleId: effectiveRule.id },
    });
    return { created: false, reason: "missing_schedule" as const };
  }
  const skipReason = shouldSkipPastReminder(effectiveRule, effectiveInput, scheduledAt);
  if (skipReason) {
    await writeNotificationLog({
      eventType: effectiveRule.eventType,
      clientId,
      appointmentId: nullableString(effectiveInput.appointmentId),
      diagnosticReportId: nullableString(effectiveInput.diagnosticReportId),
      templateId: template.id,
      status: "skipped",
      errorMessage: skipReason,
      metadata: { ruleId: effectiveRule.id },
    });
    return { created: false, reason: "skipped" as const };
  }

  const variables = buildNotificationVariables({
    ...effectiveInput,
    clientId,
    clientName: resolved.clientName ?? effectiveInput.clientName,
    clientPhone: resolved.clientPhone ?? effectiveInput.clientPhone,
  });
  const render = renderNotificationTemplate(template.body, variables);
  const status: NotificationJobStatus = render.unknownVariables.length ? "template_error" : scheduledAt <= new Date() ? "queued" : "scheduled";
  const errorMessage = render.unknownVariables.length ? `Неизвестные переменные: ${render.unknownVariables.join(", ")}` : null;
  const payload = {
    ...asRecord(effectiveInput.payload),
    ruleId: effectiveRule.id,
    conditions: effectiveRule.conditionsJson,
    notificationSettings,
    variables,
    renderedMessage: render.text,
    missingVariables: render.missingVariables,
    unknownVariables: render.unknownVariables,
    clientName: resolved.clientName ?? effectiveInput.clientName ?? null,
    clientPhone: resolved.clientPhone ?? effectiveInput.clientPhone ?? null,
  };
  const id = crypto.randomUUID();
  const key = idempotencyKey(effectiveRule, effectiveInput, clientId);
  const organizationId = getMessengerOrganizationId();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO notification_jobs
      (id, organization_id, event_type, channel, client_id, appointment_id, diagnostic_report_id, template_id,
       scheduled_at, status, idempotency_key, payload_json, error_message, branch_id, initiated_by_id, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, ${effectiveRule.eventType}, ${effectiveRule.channel}, ${clientId}, ${nullableString(effectiveInput.appointmentId)},
       ${nullableString(effectiveInput.diagnosticReportId)}, ${template.id}, ${scheduledAt}, ${status}, ${key}, ${json(payload)}::jsonb,
       ${errorMessage}, ${effectiveInput.branchId ?? effectiveRule.branchId ?? null}, ${nullableString(effectiveInput.initiatedById)}, now(), now())
    ON CONFLICT (organization_id, idempotency_key) DO NOTHING
    RETURNING id
  `;

  if (!rows[0]?.id) {
    await writeNotificationLog({
      eventType: effectiveRule.eventType,
      clientId,
      appointmentId: nullableString(effectiveInput.appointmentId),
      diagnosticReportId: nullableString(effectiveInput.diagnosticReportId),
      templateId: template.id,
      status: "duplicate_blocked",
      renderedMessage: render.text,
      errorMessage: "Одинаковое уведомление уже есть в очереди или было отправлено.",
      metadata: { idempotencyKey: key, ruleId: effectiveRule.id },
    });
    return { created: false, reason: "duplicate" as const };
  }

  const job = {
    id,
    eventType: effectiveRule.eventType,
    channel: effectiveRule.channel,
    clientId,
    appointmentId: nullableString(effectiveInput.appointmentId),
    diagnosticReportId: nullableString(effectiveInput.diagnosticReportId),
    templateId: template.id,
    initiatedById: nullableString(effectiveInput.initiatedById),
  };
  await writeNotificationLog({
    job,
    eventType: effectiveRule.eventType,
    status,
    renderedMessage: render.text,
    errorMessage,
    metadata: { ruleId: effectiveRule.id, scheduledAt: scheduledAt.toISOString() },
  });
  return { created: true, id, status };
}

export async function enqueueClientNotificationEvent(eventType: ClientNotificationEventType, input: NotificationEventContext = {}) {
  await ensureClientNotificationsSchema();
  const normalizedInput = { ...input, eventType };
  const rules = await loadEnabledRules(eventType, input.branchId);
  const results: Array<{ created: boolean; id?: string; reason?: string; status?: NotificationJobStatus }> = [];
  for (const rule of rules) {
    if (rule.conditionsJson?.skipCancelled && isCancelledContext(normalizedInput)) {
      await writeNotificationLog({
        eventType,
        clientId: nullableString(input.clientId),
        appointmentId: nullableString(input.appointmentId),
        diagnosticReportId: nullableString(input.diagnosticReportId),
        templateId: rule.templateId,
        status: "skipped",
        errorMessage: "Запись отменена.",
        metadata: { ruleId: rule.id },
      });
      continue;
    }
    const template = await loadTemplate(rule.templateId);
    if (!template || !template.isActive || template.status === "draft") {
      await writeNotificationLog({
        eventType,
        clientId: nullableString(input.clientId),
        appointmentId: nullableString(input.appointmentId),
        diagnosticReportId: nullableString(input.diagnosticReportId),
        templateId: rule.templateId,
        status: "template_error",
        errorMessage: "Шаблон отключён или не найден.",
        metadata: { ruleId: rule.id },
      });
      continue;
    }
    results.push(await createNotificationJob(rule, template, normalizedInput));
  }
  return results;
}

export async function processDueClientNotificationJobs(limit = 20) {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<NotificationJobRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      event_type AS "eventType",
      channel,
      client_id AS "clientId",
      appointment_id AS "appointmentId",
      diagnostic_report_id AS "diagnosticReportId",
      template_id AS "templateId",
      scheduled_at AS "scheduledAt",
      status,
      idempotency_key AS "idempotencyKey",
      payload_json AS "payloadJson",
      error_message AS "errorMessage",
      attempts,
      next_attempt_at AS "nextAttemptAt",
      sent_at AS "sentAt",
      provider_message_id AS "providerMessageId",
      messenger_message_id AS "messengerMessageId",
      messenger_outbox_id AS "messengerOutboxId",
      conversation_id AS "conversationId",
      branch_id AS "branchId",
      initiated_by_id AS "initiatedById",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM notification_jobs
    WHERE organization_id = ${organizationId}
      AND (
        (status IN ('scheduled', 'queued') AND scheduled_at <= now())
        OR (status = 'error' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now() AND attempts < 3)
        OR (status = 'sending' AND updated_at <= now() - interval '1 minute' AND attempts < 3)
      )
    ORDER BY scheduled_at ASC, created_at ASC
    LIMIT ${Math.max(1, Math.min(100, limit))}
  `;
  const processed = [];
  for (const job of rows) {
    processed.push(await processClientNotificationJob(job));
  }
  return processed;
}

async function finishJob(
  job: NotificationJobRow,
  status: NotificationJobStatus,
  options: {
    renderedMessage?: string | null;
    errorMessage?: string | null;
    providerMessageId?: string | null;
    messengerMessageId?: string | null;
    messengerOutboxId?: string | null;
    conversationId?: string | null;
    retry?: boolean;
    metadata?: JsonRecord;
  } = {}
) {
  const retryDelays = [1, 5, 15];
  const nextAttemptAt =
    options.retry && job.attempts < 3
      ? new Date(Date.now() + retryDelays[Math.min(job.attempts, retryDelays.length - 1)] * 60_000)
      : null;
  const nextStatus: NotificationJobStatus = options.retry && nextAttemptAt ? "error" : status;
  await prisma.$executeRaw`
    UPDATE notification_jobs
    SET status = ${nextStatus},
        error_message = ${options.errorMessage ?? null},
        provider_message_id = ${options.providerMessageId ?? null},
        messenger_message_id = ${options.messengerMessageId ?? null},
        messenger_outbox_id = ${options.messengerOutboxId ?? null},
        conversation_id = ${options.conversationId ?? null},
        next_attempt_at = ${nextAttemptAt},
        sent_at = CASE WHEN ${nextStatus} IN ('sent', 'delivered') THEN now() ELSE sent_at END,
        updated_at = now()
    WHERE id = ${job.id}
      AND organization_id = ${job.organizationId}
  `;
  await writeNotificationLog({
    job,
    eventType: job.eventType,
    status: nextStatus,
    renderedMessage: options.renderedMessage ?? null,
    errorMessage: options.errorMessage ?? null,
    providerMessageId: options.providerMessageId ?? null,
    metadata: options.metadata,
  });
  return { id: job.id, status: nextStatus, error: options.errorMessage ?? null, retryAt: dateIso(nextAttemptAt) };
}

async function processClientNotificationJob(job: NotificationJobRow) {
  let payload = asRecord(job.payloadJson);
  let conditions = asRecord(payload.conditions) as NotificationConditions;
  let renderedMessage = stringValue(payload.renderedMessage);
  let unknownVariables = arrayOfStrings(payload.unknownVariables);
  if (unknownVariables.length || job.status === "template_error") {
    const repaired = await rerenderNotificationJobWithCurrentTemplate(job, payload);
    if (!repaired.ok) {
      return finishJob(job, "template_error", {
        renderedMessage: repaired.renderedMessage || renderedMessage,
        errorMessage: repaired.errorMessage || job.errorMessage || `Неизвестные переменные: ${unknownVariables.join(", ")}`,
      });
    }
    payload = repaired.payload;
    conditions = asRecord(payload.conditions) as NotificationConditions;
    renderedMessage = repaired.renderedMessage;
    unknownVariables = [];
  }
  if (!renderedMessage) {
    return finishJob(job, "template_error", { errorMessage: "Пустой текст уведомления." });
  }
  if (isQuietTime(conditions)) {
    return finishJob(job, "skipped", {
      renderedMessage,
      errorMessage: "Уведомление попало в ночной интервал.",
      metadata: { quietHours: conditions.quietHours },
    });
  }
  if (conditions.requireConsent && (await clientConsentBlocked(job.clientId))) {
    return finishJob(job, "no_consent", { renderedMessage, errorMessage: "Нет согласия на Telegram-уведомления." });
  }

  const delivery = notificationDelivery(job, payload, renderedMessage);
  assertMessengerOutboundTextSafe(delivery.text);
  await prisma.$executeRaw`
    UPDATE notification_jobs
    SET status = 'sending',
        attempts = attempts + 1,
        updated_at = now()
    WHERE id = ${job.id}
      AND organization_id = ${job.organizationId}
  `;

  const target = await findTelegramConversation({
    clientId: job.clientId,
    clientName: stringValue(payload.clientName),
    clientPhone: stringValue(payload.clientPhone),
    appointmentId: job.appointmentId,
    diagnosticReportId: job.diagnosticReportId,
    payload,
  });
  if (!target) {
    return finishJob(job, "client_not_connected", {
      renderedMessage,
      errorMessage: "Клиент не подключён к Telegram.",
    });
  }

  let result;
  try {
    result = await sendMessage({
      conversationId: target.id,
      text: delivery.text,
      linkButton: delivery.linkButton,
      disableWebPagePreview: delivery.disableWebPagePreview,
      createdByLogin: job.initiatedById ?? undefined,
    });
  } catch (error) {
    return finishJob(job, "error", {
      renderedMessage: delivery.renderedMessage,
      errorMessage: error instanceof Error ? error.message : "Не удалось создать сообщение Telegram.",
      conversationId: target.id,
      retry: true,
    });
  }
  if (!result) {
    return finishJob(job, "error", {
      renderedMessage: delivery.renderedMessage,
      errorMessage: "Telegram-диалог не найден.",
      conversationId: target.id,
      retry: true,
    });
  }
  if (!result.ok) {
    return finishJob(job, "error", {
      renderedMessage: delivery.renderedMessage,
      errorMessage: result.error || "Telegram не отправил сообщение.",
      messengerMessageId: result.message?.id,
      messengerOutboxId: result.outbox?.id,
      conversationId: target.id,
      retry: true,
    });
  }
  const status: NotificationJobStatus = result.outbox?.status === "skipped" ? "skipped" : "sent";
  return finishJob(job, status, {
    renderedMessage: delivery.renderedMessage,
    providerMessageId: result.message.channelMessageId ?? null,
    messengerMessageId: result.message.id,
    messengerOutboxId: result.outbox?.id ?? null,
    conversationId: target.id,
  });
}

function eventTitle(eventType: ClientNotificationEventType) {
  return notificationEventDefinitions.find((event) => event.type === eventType)?.title ?? eventType;
}

function diagnosticReportLinkFromPayload(payload: JsonRecord) {
  const variables = asRecord(payload.variables);
  return (
    stringValue(variables.diagnosticReportUrl) ||
    stringValue(variables.diagnostic_report_link) ||
    stringValue(payload.diagnosticReportLink) ||
    stringValue(payload.reportUrl)
  );
}

function notificationDelivery(job: NotificationJobRow, payload: JsonRecord, renderedMessage: string) {
  if (job.eventType !== "diagnostic_sent") {
    return {
      text: renderedMessage,
      renderedMessage,
      linkButton: undefined,
      disableWebPagePreview: undefined,
    };
  }
  const reportUrl = diagnosticReportLinkFromPayload(payload);
  const compactMessage = reportUrl ? stripDiagnosticReportLink(renderedMessage, reportUrl) : renderedMessage;
  return {
    text: `${eventTitle(job.eventType)}\n\n${compactMessage}`,
    renderedMessage: compactMessage,
    linkButton: reportUrl ? { text: "Открыть отчёт", url: reportUrl } : undefined,
    disableWebPagePreview: Boolean(reportUrl),
  };
}

export async function cancelAppointmentScheduledNotifications(appointmentId: string, reason = "Запись изменилась") {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<NotificationJobRow[]>`
    UPDATE notification_jobs
    SET status = 'cancelled',
        error_message = ${reason},
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND appointment_id = ${appointmentId}
      AND event_type = 'appointment_reminder'
      AND status IN ('scheduled', 'queued')
    RETURNING
      id,
      organization_id AS "organizationId",
      event_type AS "eventType",
      channel,
      client_id AS "clientId",
      appointment_id AS "appointmentId",
      diagnostic_report_id AS "diagnosticReportId",
      template_id AS "templateId",
      scheduled_at AS "scheduledAt",
      status,
      idempotency_key AS "idempotencyKey",
      payload_json AS "payloadJson",
      error_message AS "errorMessage",
      attempts,
      next_attempt_at AS "nextAttemptAt",
      sent_at AS "sentAt",
      provider_message_id AS "providerMessageId",
      messenger_message_id AS "messengerMessageId",
      messenger_outbox_id AS "messengerOutboxId",
      conversation_id AS "conversationId",
      branch_id AS "branchId",
      initiated_by_id AS "initiatedById",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  for (const job of rows) {
    await writeNotificationLog({
      job,
      eventType: job.eventType,
      status: "cancelled",
      errorMessage: reason,
      metadata: { appointmentId },
    });
  }
  return rows.length;
}

export async function handleAppointmentCreated(input: NotificationEventContext & { source: "client" | "admin" }) {
  const eventType = input.source === "client" ? "appointment_client_created" : "appointment_admin_created";
  const immediate = await enqueueClientNotificationEvent(eventType, input);
  await cancelAppointmentScheduledNotifications(nullableString(input.appointmentId) ?? "", "Напоминания пересозданы после создания записи").catch(() => 0);
  const reminders = await enqueueClientNotificationEvent("appointment_reminder", input);
  const processed = await processDueClientNotificationJobs(10);
  return { immediate, reminders, processed };
}

export async function appointmentCreationNotificationExists(appointmentId: string | number | null | undefined) {
  const id = nullableString(appointmentId == null ? null : String(appointmentId));
  if (!id) return false;
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT true AS "exists"
    FROM notification_jobs
    WHERE organization_id = ${organizationId}
      AND appointment_id = ${id}
      AND event_type IN ('appointment_client_created', 'appointment_admin_created')
    LIMIT 1
  `;
  return Boolean(rows[0]?.exists);
}

export async function handleAppointmentUpdated(input: NotificationEventContext) {
  const appointmentId = nullableString(input.appointmentId);
  if (appointmentId) await cancelAppointmentScheduledNotifications(appointmentId, "Напоминания пересозданы после изменения записи");
  const reminders = await enqueueClientNotificationEvent("appointment_reminder", input);
  const events = [];
  const status = stringValue(input.status).toLowerCase();
  if (["arrived", "in_work", "client_arrived"].includes(status)) {
    events.push(...(await enqueueClientNotificationEvent("client_arrived", input)));
    events.push(...(await enqueueClientNotificationEvent("review_after_visit", input)));
  }
  if (["left", "completed", "visit_completed"].includes(status)) {
    events.push(...(await enqueueClientNotificationEvent("visit_completed", input)));
  }
  if (["done", "vehicle_ready"].includes(status)) {
    events.push(...(await enqueueClientNotificationEvent("vehicle_ready", input)));
  }
  if (["no_show", "no-show", "appointment_no_show"].includes(status)) {
    events.push(...(await enqueueClientNotificationEvent("appointment_no_show", input)));
  }
  const processed = await processDueClientNotificationJobs(10);
  return { reminders, events, processed };
}

export async function handleAppointmentCancelled(appointmentId: string) {
  const cancelled = await cancelAppointmentScheduledNotifications(appointmentId, "Запись отменена");
  return { cancelled };
}

async function resolveDiagnosticTarget(request: NextRequest, diagnosticId: string, source?: "map" | "legacy") {
  if (source !== "legacy") {
    const mapRows = await prisma.$queryRaw<
      Array<{
        id: string;
        clientId: string | null;
        clientName: string | null;
        clientPhone: string | null;
        demandId: string | null;
        publicToken: string | null;
        brand: string | null;
        model: string | null;
        licensePlate: string | null;
        vin: string | null;
        checkedCount: number;
        recommendationCount: number;
        criticalCount: number;
        warningCount: number;
      }>
    >`
    SELECT
      id,
      client_id AS "clientId",
      client_name AS "clientName",
      client_phone AS "clientPhone",
      demand_id AS "demandId",
      public_token AS "publicToken",
      brand,
      model,
      license_plate AS "licensePlate",
      vin,
      total_count AS "checkedCount",
      attention_count AS "recommendationCount",
      replace_count AS "criticalCount",
      attention_count AS "warningCount"
    FROM diagnostic_map_sessions
    WHERE id = ${diagnosticId}
    LIMIT 1
  `;
    const map = mapRows[0];
    if (map) {
      const counterparty = await resolveLocalCounterparty(map.clientId, normalizePhoneKey(map.clientPhone));
      return {
        diagnosticReportId: map.id,
        clientId: counterparty?.id ?? map.clientId,
        clientName: counterparty?.name ?? map.clientName,
        clientPhone: counterparty?.phone ?? counterparty?.normalizedPhone ?? map.clientPhone,
        diagnosticReportLink: map.publicToken ? buildDiagnosticReportUrl(request, map.publicToken) : null,
        car: [map.brand, map.model, map.licensePlate || map.vin].filter(Boolean).join(" · "),
        carMake: map.brand,
        carModel: map.model,
        licensePlate: map.licensePlate,
        vin: map.vin,
        checkedCount: map.checkedCount,
        recommendationCount: map.recommendationCount,
        criticalCount: map.criticalCount,
        warningCount: map.warningCount,
        payload: { source: "map", shipmentId: map.demandId, checkedCount: map.checkedCount, recommendationCount: map.recommendationCount },
      } satisfies NotificationEventContext;
    }
    if (source === "map") return null;
  }

  const legacy = await prisma.diagnostic.findUnique({
    where: { id: diagnosticId },
    select: {
      id: true,
      agentMoySkladId: true,
      shipmentMoySkladId: true,
      shipmentDraftId: true,
      clientReportToken: true,
      brand: true,
      model: true,
      licensePlate: true,
      vin: true,
      summaryGreen: true,
      summaryRed: true,
      summaryYellow: true,
    },
  });
  if (!legacy) return null;
  const counterparty = legacy.agentMoySkladId
    ? await prisma.localCounterparty.findFirst({
        where: { OR: [{ id: legacy.agentMoySkladId }, { moyskladId: legacy.agentMoySkladId }] },
        select: { id: true, name: true, phone: true },
      })
    : null;
  return {
    diagnosticReportId: legacy.id,
    clientId: counterparty?.id ?? legacy.agentMoySkladId,
    clientName: counterparty?.name ?? null,
    clientPhone: counterparty?.phone ?? null,
    diagnosticReportLink: legacy.clientReportToken ? buildDiagnosticReportUrl(request, legacy.clientReportToken) : null,
    car: [legacy.brand, legacy.model, legacy.licensePlate || legacy.vin].filter(Boolean).join(" · "),
    carMake: legacy.brand,
    carModel: legacy.model,
    licensePlate: legacy.licensePlate,
    vin: legacy.vin,
    checkedCount: legacy.summaryGreen + legacy.summaryYellow + legacy.summaryRed,
    recommendationCount: legacy.summaryYellow,
    criticalCount: legacy.summaryRed,
    warningCount: legacy.summaryYellow,
    payload: {
      source: "legacy",
      shipmentId: legacy.shipmentMoySkladId ?? legacy.shipmentDraftId,
      checkedCount: legacy.summaryGreen + legacy.summaryYellow + legacy.summaryRed,
      recommendationCount: legacy.summaryYellow,
    },
  } satisfies NotificationEventContext;
}

async function requeueDiagnosticNotificationJobs(target: NotificationEventContext) {
  const diagnosticReportId = nullableString(target.diagnosticReportId);
  if (!diagnosticReportId) return [];
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE notification_jobs
    SET status = 'queued',
        scheduled_at = now(),
        next_attempt_at = NULL,
        error_message = NULL,
        attempts = 0,
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND event_type = 'diagnostic_sent'
      AND diagnostic_report_id = ${diagnosticReportId}
      AND (${nullableString(target.clientId)}::text IS NULL OR client_id = ${nullableString(target.clientId)})
      AND status IN ('scheduled', 'queued', 'sending', 'error', 'client_not_connected')
    RETURNING id
  `;
  return rows.map((row) => row.id);
}

function pickProcessedDiagnosticResult(
  processed: Awaited<ReturnType<typeof processDueClientNotificationJobs>>,
  jobIds: string[]
) {
  const relevantIds = new Set(jobIds.filter(Boolean));
  if (!relevantIds.size) return undefined;
  const relevant = processed.filter((item) => relevantIds.has(item.id));
  return relevant.find((item) => item.status === "sent" || item.status === "skipped") ?? relevant[0];
}

export async function handleDiagnosticReportSent(input: {
  request: NextRequest;
  diagnosticId: string;
  source?: "map" | "legacy";
  initiatedById?: string | null;
}) {
  await ensureClientNotificationsSchema();
  const target = await resolveDiagnosticTarget(input.request, input.diagnosticId, input.source);
  if (!target) return null;
  const queued = await enqueueClientNotificationEvent("diagnostic_sent", {
    ...target,
    initiatedById: input.initiatedById,
    payload: { ...asRecord(target.payload), source: input.source ?? target.payload?.source },
  });
  const jobIds = queued.map((item) => item.id).filter((id): id is string => Boolean(id));
  let processed = await processDueClientNotificationJobs(100);
  let sent = pickProcessedDiagnosticResult(processed, jobIds);
  if (!sent && queued.some((item) => item.reason === "duplicate")) {
    const requeuedIds = await requeueDiagnosticNotificationJobs(target);
    if (requeuedIds.length > 0) {
      jobIds.push(...requeuedIds);
      processed = [...processed, ...(await processDueClientNotificationJobs(100))];
      sent = pickProcessedDiagnosticResult(processed, jobIds);
    }
  }
  const status = sent?.status ?? queued.find((item) => item.status)?.status ?? "queued";
  const ok = Boolean(sent && (sent.status === "sent" || sent.status === "skipped"));
  return {
    ok,
    status,
    error: ok
      ? undefined
      : sent?.error ?? (status === "client_not_connected" ? "Не удалось найти или открыть Telegram-диалог клиента." : "Отчёт не отправлен в Telegram."),
    reportUrl: target.diagnosticReportLink,
    clientId: target.clientId ?? null,
    queued,
    processed,
  };
}

export async function markDiagnosticReportSent(source: "map" | "legacy", diagnosticId: string) {
  if (source === "map") {
    await prisma.$executeRaw`
      UPDATE diagnostic_map_sessions
      SET report_sent_at = now(), updated_at = now()
      WHERE id = ${diagnosticId}
    `;
    return;
  }
  await prisma.$executeRaw`
    UPDATE diagnostics
    SET client_report_sent_at = now(), updated_at = now()
    WHERE id = ${diagnosticId}
  `;
}

export async function updateClientNotificationSettings(input: Partial<ClientNotificationSettings>) {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const current = await loadClientNotificationSettingsInternal(organizationId);
  const next = sanitizeClientNotificationSettings(input, current);
  const reviewDelayMinutes = Math.max(0, next.reviewDelayHours * 60);
  const rows = await prisma.$queryRaw<NotificationSettingsRow[]>`
    INSERT INTO notification_settings
      (id, organization_id, settings_json, created_at, updated_at)
    VALUES
      (${`${organizationId}:settings:client-notifications`}, ${organizationId}, ${json(next)}::jsonb, now(), now())
    ON CONFLICT (organization_id) DO UPDATE
    SET settings_json = ${json(next)}::jsonb,
        updated_at = now()
    RETURNING id, organization_id AS "organizationId", settings_json AS "settingsJson", created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  await prisma.$executeRaw`
    UPDATE notification_rules
    SET enabled = ${next.postVisitReviewEnabled},
        timing_type = 'delayed_after_event',
        offset_minutes = ${reviewDelayMinutes},
        conditions_json = conditions_json || ${json({ reviewDelayMinutes, requireReviewLink: true })}::jsonb,
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND event_type = 'review_after_visit'
      AND id = ${orgScopedId(organizationId, "rule", "review-after-visit")}
  `;
  return sanitizeClientNotificationSettings(rows[0]?.settingsJson ?? next);
}

export async function listClientNotificationSettings() {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const [templates, rules, logs, jobs, channels, kpiRows, notificationSettings] = await Promise.all([
    prisma.$queryRaw<NotificationTemplateRow[]>`
      SELECT id, organization_id AS "organizationId", name, event_type AS "eventType", channel, body, is_active AS "isActive",
             branch_id AS "branchId", status, metadata_json AS "metadataJson", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM notification_templates
      WHERE organization_id = ${organizationId}
      ORDER BY event_type ASC, name ASC
    `,
    prisma.$queryRaw<NotificationRuleRow[]>`
      SELECT id, organization_id AS "organizationId", event_type AS "eventType", enabled, channel, template_id AS "templateId",
             timing_type AS "timingType", offset_minutes AS "offsetMinutes", conditions_json AS "conditionsJson",
             branch_id AS "branchId", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM notification_rules
      WHERE organization_id = ${organizationId}
      ORDER BY event_type ASC, offset_minutes NULLS LAST, created_at ASC
    `,
    prisma.$queryRaw<NotificationLogRow[]>`
      SELECT id, organization_id AS "organizationId", notification_job_id AS "notificationJobId", event_type AS "eventType", channel,
             client_id AS "clientId", appointment_id AS "appointmentId", diagnostic_report_id AS "diagnosticReportId",
             template_id AS "templateId", status, rendered_message AS "renderedMessage", error_message AS "errorMessage",
             provider_message_id AS "providerMessageId", initiated_by_id AS "initiatedById", metadata_json AS "metadataJson",
             created_at AS "createdAt"
      FROM notification_logs
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT 120
    `,
    prisma.$queryRaw<NotificationJobRow[]>`
      SELECT id, organization_id AS "organizationId", event_type AS "eventType", channel, client_id AS "clientId",
             appointment_id AS "appointmentId", diagnostic_report_id AS "diagnosticReportId", template_id AS "templateId",
             scheduled_at AS "scheduledAt", status, idempotency_key AS "idempotencyKey", payload_json AS "payloadJson",
             error_message AS "errorMessage", attempts, next_attempt_at AS "nextAttemptAt", sent_at AS "sentAt",
             provider_message_id AS "providerMessageId", messenger_message_id AS "messengerMessageId",
             messenger_outbox_id AS "messengerOutboxId", conversation_id AS "conversationId", branch_id AS "branchId",
             initiated_by_id AS "initiatedById", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM notification_jobs
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT 80
    `,
    listMessengerChannels().catch(() => []),
    prisma.$queryRaw<Array<{ status: NotificationJobStatus; count: bigint }>>`
      SELECT status, COUNT(*)::bigint AS count
      FROM notification_jobs
      WHERE organization_id = ${organizationId}
      GROUP BY status
    `,
    loadClientNotificationSettingsInternal(organizationId),
  ]);
  const telegram = channels.find((channel) => channel.key === "telegram") ?? null;
  const lastSuccess = logs.find((log) => log.status === "sent" || log.status === "delivered");
  return {
    events: notificationEventDefinitions,
    notificationSettings,
    variables: notificationVariableGroups,
    templates: templates.map(mapTemplate),
    rules: rules.map(mapRule),
    logs: logs.map(mapLog),
    jobs: jobs.map(mapJob),
    channel: {
      telegramConnected: telegram?.connectionStatus === "connected",
      connectionStatus: telegram?.connectionStatus ?? "not_connected",
      botName: telegram?.connection?.displayName ?? telegram?.label ?? "Telegram",
      webhookStatus: telegram?.connection?.connectionStatus ?? telegram?.connectionStatus ?? "not_connected",
      lastSuccessfulSendAt: lastSuccess?.createdAt?.toISOString() ?? null,
    },
    stats: Object.fromEntries(kpiRows.map((row) => [row.status, Number(row.count)])),
    statusLabels: {
      scheduled: notificationStatusLabel("scheduled"),
      queued: notificationStatusLabel("queued"),
      sending: notificationStatusLabel("sending"),
      sent: notificationStatusLabel("sent"),
      delivered: notificationStatusLabel("delivered"),
      error: notificationStatusLabel("error"),
      cancelled: notificationStatusLabel("cancelled"),
      skipped: notificationStatusLabel("skipped"),
      client_not_connected: notificationStatusLabel("client_not_connected"),
      no_consent: notificationStatusLabel("no_consent"),
      duplicate_blocked: notificationStatusLabel("duplicate_blocked"),
      template_error: notificationStatusLabel("template_error"),
    },
  };
}

export async function updateNotificationRule(input: {
  id: string;
  enabled?: boolean;
  templateId?: string;
  timingType?: string;
  offsetMinutes?: number | null;
  conditions?: NotificationConditions;
}) {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<NotificationRuleRow[]>`
    UPDATE notification_rules
    SET enabled = COALESCE(${input.enabled ?? null}, enabled),
        template_id = COALESCE(${input.templateId ?? null}, template_id),
        timing_type = COALESCE(${input.timingType ?? null}, timing_type),
        offset_minutes = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "offsetMinutes")} THEN ${input.offsetMinutes ?? null} ELSE offset_minutes END,
        conditions_json = COALESCE(${input.conditions ? json(input.conditions) : null}::jsonb, conditions_json),
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND id = ${input.id}
    RETURNING id, organization_id AS "organizationId", event_type AS "eventType", enabled, channel, template_id AS "templateId",
              timing_type AS "timingType", offset_minutes AS "offsetMinutes", conditions_json AS "conditionsJson",
              branch_id AS "branchId", created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  return rows[0] ? mapRule(rows[0]) : null;
}

export async function createReminderRule(input: { offsetMinutes: number; templateId?: string | null }) {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const templateId = input.templateId || orgScopedId(organizationId, "tpl", "appointment-reminder");
  const id = `${organizationId}:rule:appointment-reminder-${Math.max(1, Math.trunc(input.offsetMinutes))}m-${crypto.randomUUID().slice(0, 8)}`;
  const rows = await prisma.$queryRaw<NotificationRuleRow[]>`
    INSERT INTO notification_rules
      (id, organization_id, event_type, enabled, channel, template_id, timing_type, offset_minutes, conditions_json, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, 'appointment_reminder', true, 'telegram', ${templateId}, 'before_appointment',
       ${Math.max(1, Math.trunc(input.offsetMinutes))}, ${json({ ...defaultConditions, doNotSendAtNight: true })}::jsonb, now(), now())
    RETURNING id, organization_id AS "organizationId", event_type AS "eventType", enabled, channel, template_id AS "templateId",
              timing_type AS "timingType", offset_minutes AS "offsetMinutes", conditions_json AS "conditionsJson",
              branch_id AS "branchId", created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  return rows[0] ? mapRule(rows[0]) : null;
}

export async function deleteNotificationRule(id: string) {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  await prisma.$executeRaw`
    DELETE FROM notification_rules
    WHERE organization_id = ${organizationId}
      AND id = ${id}
      AND event_type = 'appointment_reminder'
  `;
  return { ok: true };
}

export async function updateNotificationTemplate(input: {
  id: string;
  name?: string;
  body?: string;
  isActive?: boolean;
  status?: string;
}) {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const preview = input.body ? renderNotificationTemplate(input.body, buildNotificationVariables(sampleNotificationContext())) : null;
  if (preview?.unknownVariables.length) {
    throw new Error(`Неизвестные переменные: ${preview.unknownVariables.join(", ")}. Используйте список переменных справа.`);
  }
  const metadata = input.body
    ? {
        variables: preview?.variableDetails.filter((item) => item.used).map((item) => item.key) ?? extractTemplateVariables(input.body),
        updatedFromSettings: true,
      }
    : null;
  const rows = await prisma.$queryRaw<NotificationTemplateRow[]>`
    UPDATE notification_templates
    SET name = COALESCE(${input.name ?? null}, name),
        body = COALESCE(${input.body ?? null}, body),
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        status = COALESCE(${input.status ?? null}, status),
        metadata_json = CASE WHEN ${metadata ? json(metadata) : null}::jsonb IS NULL THEN metadata_json ELSE metadata_json || ${metadata ? json(metadata) : null}::jsonb END,
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND id = ${input.id}
    RETURNING id, organization_id AS "organizationId", name, event_type AS "eventType", channel, body, is_active AS "isActive",
              branch_id AS "branchId", status, metadata_json AS "metadataJson", created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  return rows[0] ? mapTemplate(rows[0]) : null;
}

export async function sendTestNotification(input: {
  templateId: string;
  clientId?: string | null;
  clientPhone?: string | null;
  clientName?: string | null;
  telegramId?: string | null;
}) {
  await ensureClientNotificationsSchema();
  const template = await loadTemplate(input.templateId);
  if (!template) throw new Error("Шаблон не найден");
  const rule: NotificationRuleRow = {
    id: `test:${crypto.randomUUID()}`,
    organizationId: getMessengerOrganizationId(),
    eventType: template.eventType,
    enabled: true,
    channel: "telegram",
    templateId: template.id,
    timingType: "immediate",
    offsetMinutes: null,
    conditionsJson: { ...defaultConditions, preventDuplicates: false },
    branchId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const context = sampleNotificationContext({
    clientId: input.clientId,
    clientPhone: input.clientPhone,
    clientName: input.clientName,
    payload: { telegramId: input.telegramId },
  });
  const result = await createNotificationJob(rule, template, {
    ...context,
    payload: { ...asRecord(context.payload), test: true, sourceId: `test-${crypto.randomUUID()}` },
  });
  const processed = await processDueClientNotificationJobs(5);
  return { result, processed };
}

export async function retryNotificationJob(id: string) {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  await prisma.$executeRaw`
    UPDATE notification_jobs
    SET status = 'queued',
        attempts = 0,
        next_attempt_at = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND id = ${id}
      AND status IN ('error', 'client_not_connected', 'no_consent', 'skipped', 'sending', 'template_error')
  `;
  return processDueClientNotificationJobs(5);
}
