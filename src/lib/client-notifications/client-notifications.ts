import crypto from "crypto";
import type { NextRequest } from "next/server";
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
  branchId?: string | null;
  branchName?: string | null;
  address?: string | null;
  companyPhone?: string | null;
  telegramLink?: string | null;
  criticalCount?: number | null;
  warningCount?: number | null;
  status?: string | null;
  isCancelled?: boolean;
  initiatedById?: string | null;
  source?: string | null;
  payload?: JsonRecord | null;
  force?: boolean;
};

type RenderResult = {
  text: string;
  variables: Record<string, string>;
  missingVariables: string[];
  unknownVariables: string[];
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
    title: "Диагностика отправлена",
    description: "Клиент получает ссылку на публичный отчёт диагностики.",
    defaultTiming: "После нажатия «Отправить клиенту»",
  },
  {
    type: "client_arrived",
    title: "Клиент приехал",
    description: "Приветствие при статусе «Клиент приехал», «В боксе» или «Работа начата».",
    defaultTiming: "При статусе «Клиент приехал»",
  },
  {
    type: "visit_completed",
    title: "Визит завершён",
    description: "Благодарность и, если включено, просьба оставить отзыв.",
    defaultTiming: "Через 30 минут после завершения",
  },
  {
    type: "review_after_visit",
    title: "Отзыв после визита",
    description: "Отдельная просьба оставить отзыв после завершения визита.",
    defaultTiming: "Через 30 минут после завершения",
  },
  { type: "appointment_rescheduled", title: "Запись перенесена", description: "Будущее событие для переноса записи.", defaultTiming: "Сразу", future: true },
  { type: "appointment_cancelled", title: "Запись отменена", description: "Будущее событие для отмены записи.", defaultTiming: "Сразу", future: true },
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

export const notificationVariableGroups = [
  { title: "Клиент", variables: ["client_name", "client_phone"] },
  { title: "Запись", variables: ["appointment_date", "appointment_time", "appointment_datetime", "service_list", "manager_name", "master_name"] },
  { title: "Автомобиль", variables: ["car", "car_make", "car_model", "license_plate", "vin"] },
  { title: "Сервис", variables: ["service_name", "branch_name", "address", "company_phone", "telegram_link"] },
  { title: "Ссылки", variables: ["diagnostic_report_link", "review_link", "order_link", "precheck_link"] },
  { title: "Диагностика", variables: ["critical_count", "warning_count"] },
];

const supportedVariableSet = new Set(notificationVariableGroups.flatMap((group) => group.variables));

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
    body: "Здравствуйте, {client_name}! Вы записаны в автосервис \"{service_name}\" на {appointment_date} в {appointment_time}. Автомобиль: {car}. Адрес: {address}. Ждём вас!",
  },
  {
    key: "appointment-admin-confirm",
    name: "Подтверждение записи администратором",
    eventType: "appointment_admin_created",
    body: "Здравствуйте, {client_name}! Администратор записал вас в автосервис \"{service_name}\" на {appointment_date} в {appointment_time}. Автомобиль: {car}. Ждём вас по адресу: {address}.",
  },
  {
    key: "appointment-reminder",
    name: "Напоминание перед визитом",
    eventType: "appointment_reminder",
    body: "Здравствуйте, {client_name}! Напоминаем, что сегодня в {appointment_time} у вас запись в \"{service_name}\". Автомобиль: {car}. Адрес: {address}.",
  },
  {
    key: "diagnostic-ready",
    name: "Диагностика готова",
    eventType: "diagnostic_sent",
    body: "Здравствуйте, {client_name}! Диагностика по автомобилю {car} готова. Посмотреть отчёт: {diagnostic_report_link}",
  },
  {
    key: "client-arrived",
    name: "Клиент приехал",
    eventType: "client_arrived",
    body: "Добро пожаловать в \"{service_name}\", {client_name}! Мы отметили ваш приезд. Скоро мастер приступит к работе с автомобилем {car}.",
  },
  {
    key: "visit-review",
    name: "Визит завершён / отзыв",
    eventType: "visit_completed",
    body: "{client_name}, спасибо, что выбрали \"{service_name}\"! Будем благодарны за отзыв о визите: {review_link}",
  },
  {
    key: "appointment-rescheduled",
    name: "Запись перенесена",
    eventType: "appointment_rescheduled",
    body: "Здравствуйте, {client_name}! Ваша запись перенесена на {appointment_date} в {appointment_time}. Автомобиль: {car}.",
  },
  {
    key: "appointment-cancelled",
    name: "Запись отменена",
    eventType: "appointment_cancelled",
    body: "Здравствуйте, {client_name}. Ваша запись на {appointment_date} в {appointment_time} отменена. Если хотите выбрать другое время, напишите нам.",
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
    enabled: true,
    timingType: "delayed_after_event",
    offsetMinutes: 30,
    conditions: { ...defaultConditions, reviewDelayMinutes: 30 },
  },
  { key: "appointment-rescheduled", eventType: "appointment_rescheduled", templateKey: "appointment-rescheduled", enabled: false, timingType: "immediate" },
  { key: "appointment-cancelled", eventType: "appointment_cancelled", templateKey: "appointment-cancelled", enabled: false, timingType: "immediate" },
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

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
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

      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_org_idempotency_uidx ON notification_jobs(organization_id, idempotency_key)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_templates_org_event_idx ON notification_templates(organization_id, event_type, channel, is_active)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_rules_org_event_idx ON notification_rules(organization_id, event_type, enabled)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_jobs_org_status_idx ON notification_jobs(organization_id, status, scheduled_at)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_jobs_appointment_idx ON notification_jobs(appointment_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_jobs_diagnostic_idx ON notification_jobs(diagnostic_report_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_logs_org_created_idx ON notification_logs(organization_id, created_at DESC)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_logs_org_event_idx ON notification_logs(organization_id, event_type)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS notification_logs_org_status_idx ON notification_logs(organization_id, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS client_notification_preferences_org_idx ON client_notification_preferences(organization_id, telegram_enabled, consent_status)`;

      for (const template of defaultTemplates) {
        await prisma.$executeRaw`
          INSERT INTO notification_templates
            (id, organization_id, name, event_type, channel, body, is_active, status, metadata_json, created_at, updated_at)
          VALUES
            (${orgScopedId(organizationId, "tpl", template.key)}, ${organizationId}, ${template.name}, ${template.eventType},
             'telegram', ${template.body}, ${template.active ?? true}, 'active',
             ${json({ systemDefault: true, key: template.key })}::jsonb, now(), now())
          ON CONFLICT (id) DO NOTHING
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
  const defaults: Record<string, string> = {
    client_name: "клиент",
    client_phone: "",
    service_name: process.env.NEXT_PUBLIC_SERVICE_NAME?.trim() || process.env.SERVICE_NAME?.trim() || "Там где масло",
    branch_name: process.env.NEXT_PUBLIC_BRANCH_NAME?.trim() || process.env.BRANCH_NAME?.trim() || "",
    address: process.env.NEXT_PUBLIC_SERVICE_ADDRESS?.trim() || process.env.SERVICE_ADDRESS?.trim() || "",
    car: "ваш автомобиль",
    car_make: "",
    car_model: "",
    license_plate: "",
    vin: "",
    service_list: "",
    manager_name: "",
    master_name: "",
    diagnostic_report_link: "",
    review_link: process.env.NEXT_PUBLIC_REVIEW_LINK?.trim() || process.env.REVIEW_LINK?.trim() || "",
    order_link: "",
    precheck_link: "",
    company_phone: process.env.NEXT_PUBLIC_COMPANY_PHONE?.trim() || process.env.COMPANY_PHONE?.trim() || "",
    telegram_link: process.env.NEXT_PUBLIC_TELEGRAM_LINK?.trim() || process.env.TELEGRAM_LINK?.trim() || "",
    critical_count: "0",
    warning_count: "0",
  };
  return defaults[key] ?? "";
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
  const car =
    stringValue(input.car) ||
    [input.carMake, input.carModel, input.licensePlate || input.vin].map(stringValue).filter(Boolean).join(" · ");
  const values: Record<string, string> = {
    client_name: stringValue(input.clientName),
    client_phone: stringValue(input.clientPhone),
    service_name: defaultVariableValue("service_name"),
    branch_name: stringValue(input.branchName) || defaultVariableValue("branch_name"),
    address: stringValue(input.address) || defaultVariableValue("address"),
    appointment_date: at ? formatServiceDate(at) : stringValue(input.appointmentDate),
    appointment_time: at ? formatServiceTime(at) : stringValue(input.appointmentTime),
    appointment_datetime: at ? formatServiceDateTime(at) : [input.appointmentDate, input.appointmentTime].map(stringValue).filter(Boolean).join(" "),
    car,
    car_make: stringValue(input.carMake),
    car_model: stringValue(input.carModel),
    license_plate: stringValue(input.licensePlate),
    vin: stringValue(input.vin),
    service_list: stringValue(input.serviceList),
    manager_name: stringValue(input.managerName),
    master_name: stringValue(input.masterName),
    diagnostic_report_link: stringValue(input.diagnosticReportLink),
    review_link: stringValue(input.reviewLink) || defaultVariableValue("review_link"),
    order_link: stringValue(input.orderLink),
    precheck_link: stringValue(input.precheckLink),
    company_phone: stringValue(input.companyPhone) || defaultVariableValue("company_phone"),
    telegram_link: stringValue(input.telegramLink) || defaultVariableValue("telegram_link"),
    critical_count: input.criticalCount == null ? "" : String(input.criticalCount),
    warning_count: input.warningCount == null ? "" : String(input.warningCount),
  };

  for (const key of supportedVariableSet) {
    values[key] = values[key] || defaultVariableValue(key);
  }
  return values;
}

export function renderNotificationTemplate(body: string, variables: Record<string, string>): RenderResult {
  const unknownVariables = new Set<string>();
  const missingVariables = new Set<string>();
  const usedVariables: Record<string, string> = {};
  const optionalLineVariables = new Set(["address", "review_link", "order_link", "precheck_link", "telegram_link", "company_phone"]);
  const tokenPattern = /\{\{\s*([a-zA-Z0-9_]+)(?:\|([^}]+))?\s*\}\}|\{\s*([a-zA-Z0-9_]+)(?:\|([^}]+))?\s*\}/g;

  const lines = body.split(/\r?\n/).map((line) => {
    const missingInLine = new Set<string>();
    const variablesInLine = new Set<string>();
    const rendered = line.replace(tokenPattern, (_match, doubleKey: string, doubleFallback: string, singleKey: string, singleFallback: string) => {
      const key = doubleKey || singleKey;
      const fallback = doubleFallback ?? singleFallback;
      variablesInLine.add(key);
      if (!supportedVariableSet.has(key)) {
        unknownVariables.add(key);
        return `{${key}}`;
      }
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
      if (key !== "address") return text;
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
    branchName: defaultVariableValue("branch_name") || "Основной сервис",
    address: defaultVariableValue("address") || "Калининград, ул. Сервисная, 1",
    companyPhone: defaultVariableValue("company_phone") || "+7 4012 00-00-00",
    diagnosticReportLink: "https://example.com/report/demo",
    reviewLink: defaultVariableValue("review_link") || "https://example.com/review",
    orderLink: "https://example.com/order/demo",
    precheckLink: "https://example.com/precheck/demo",
    telegramLink: defaultVariableValue("telegram_link") || "https://t.me/tam_gde_maslo",
    criticalCount: 1,
    warningCount: 3,
    ...overrides,
  };
}

export async function previewNotificationTemplate(templateIdOrBody: string, context: NotificationEventContext = {}) {
  await ensureClientNotificationsSchema();
  const template = templateIdOrBody.includes("{") || templateIdOrBody.includes("\n") ? null : await loadTemplate(templateIdOrBody);
  const body = template?.body ?? templateIdOrBody;
  const variables = buildNotificationVariables(sampleNotificationContext(context));
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

function idempotencyKey(rule: NotificationRuleRow, template: NotificationTemplateRow, input: NotificationEventContext, clientId: string | null) {
  const eventType = rule.eventType;
  if (eventType === "diagnostic_sent") {
    return [eventType, input.diagnosticReportId ?? input.payload?.diagnosticReportId ?? input.appointmentId ?? "diagnostic", clientId ?? normalizePhoneKey(input.clientPhone) ?? "client"].join(":");
  }
  if (eventType === "appointment_reminder") {
    return [eventType, input.appointmentId ?? "appointment", rule.offsetMinutes ?? 0].join(":");
  }
  return [eventType, input.appointmentId ?? input.diagnosticReportId ?? input.payload?.sourceId ?? "entity", clientId ?? normalizePhoneKey(input.clientPhone) ?? "client", template.id].join(":");
}

async function createNotificationJob(rule: NotificationRuleRow, template: NotificationTemplateRow, input: NotificationEventContext) {
  const resolved = await resolveClientIdentity(input);
  const clientId = resolved.clientId;
  const scheduledAt = scheduledAtForRule(rule, input);
  if (!scheduledAt) {
    await writeNotificationLog({
      eventType: rule.eventType,
      clientId,
      appointmentId: nullableString(input.appointmentId),
      diagnosticReportId: nullableString(input.diagnosticReportId),
      templateId: template.id,
      status: "skipped",
      errorMessage: "Не удалось определить время отправки.",
      metadata: { ruleId: rule.id },
    });
    return { created: false, reason: "missing_schedule" as const };
  }
  const skipReason = shouldSkipPastReminder(rule, input, scheduledAt);
  if (skipReason) {
    await writeNotificationLog({
      eventType: rule.eventType,
      clientId,
      appointmentId: nullableString(input.appointmentId),
      diagnosticReportId: nullableString(input.diagnosticReportId),
      templateId: template.id,
      status: "skipped",
      errorMessage: skipReason,
      metadata: { ruleId: rule.id },
    });
    return { created: false, reason: "skipped" as const };
  }

  const variables = buildNotificationVariables({
    ...input,
    clientId,
    clientName: resolved.clientName ?? input.clientName,
    clientPhone: resolved.clientPhone ?? input.clientPhone,
  });
  const render = renderNotificationTemplate(template.body, variables);
  const status: NotificationJobStatus = render.unknownVariables.length ? "template_error" : scheduledAt <= new Date() ? "queued" : "scheduled";
  const errorMessage = render.unknownVariables.length ? `Неизвестные переменные: ${render.unknownVariables.join(", ")}` : null;
  const payload = {
    ...asRecord(input.payload),
    ruleId: rule.id,
    conditions: rule.conditionsJson,
    variables,
    renderedMessage: render.text,
    missingVariables: render.missingVariables,
    unknownVariables: render.unknownVariables,
    clientName: resolved.clientName ?? input.clientName ?? null,
    clientPhone: resolved.clientPhone ?? input.clientPhone ?? null,
  };
  const id = crypto.randomUUID();
  const key = idempotencyKey(rule, template, input, clientId);
  const organizationId = getMessengerOrganizationId();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO notification_jobs
      (id, organization_id, event_type, channel, client_id, appointment_id, diagnostic_report_id, template_id,
       scheduled_at, status, idempotency_key, payload_json, error_message, branch_id, initiated_by_id, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, ${rule.eventType}, ${rule.channel}, ${clientId}, ${nullableString(input.appointmentId)},
       ${nullableString(input.diagnosticReportId)}, ${template.id}, ${scheduledAt}, ${status}, ${key}, ${json(payload)}::jsonb,
       ${errorMessage}, ${input.branchId ?? rule.branchId ?? null}, ${nullableString(input.initiatedById)}, now(), now())
    ON CONFLICT (organization_id, idempotency_key) DO NOTHING
    RETURNING id
  `;

  if (!rows[0]?.id) {
    await writeNotificationLog({
      eventType: rule.eventType,
      clientId,
      appointmentId: nullableString(input.appointmentId),
      diagnosticReportId: nullableString(input.diagnosticReportId),
      templateId: template.id,
      status: "duplicate_blocked",
      renderedMessage: render.text,
      errorMessage: "Одинаковое уведомление уже есть в очереди или было отправлено.",
      metadata: { idempotencyKey: key, ruleId: rule.id },
    });
    return { created: false, reason: "duplicate" as const };
  }

  const job = {
    id,
    eventType: rule.eventType,
    channel: rule.channel,
    clientId,
    appointmentId: nullableString(input.appointmentId),
    diagnosticReportId: nullableString(input.diagnosticReportId),
    templateId: template.id,
    initiatedById: nullableString(input.initiatedById),
  };
  await writeNotificationLog({
    job,
    eventType: rule.eventType,
    status,
    renderedMessage: render.text,
    errorMessage,
    metadata: { ruleId: rule.id, scheduledAt: scheduledAt.toISOString() },
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
        OR status = 'template_error'
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
  const payload = asRecord(job.payloadJson);
  const conditions = asRecord(payload.conditions) as NotificationConditions;
  const renderedMessage = stringValue(payload.renderedMessage);
  const unknownVariables = Array.isArray(payload.unknownVariables) ? payload.unknownVariables.map(String) : [];
  if (unknownVariables.length || job.status === "template_error") {
    return finishJob(job, "template_error", {
      renderedMessage,
      errorMessage: job.errorMessage || `Неизвестные переменные: ${unknownVariables.join(", ")}`,
    });
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

  assertMessengerOutboundTextSafe(renderedMessage);
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
      text: `Автоуведомление · ${eventTitle(job.eventType)}\n\n${renderedMessage}`,
      createdByLogin: job.initiatedById ?? undefined,
    });
  } catch (error) {
    return finishJob(job, "error", {
      renderedMessage,
      errorMessage: error instanceof Error ? error.message : "Не удалось создать сообщение Telegram.",
      conversationId: target.id,
      retry: true,
    });
  }
  if (!result) {
    return finishJob(job, "error", {
      renderedMessage,
      errorMessage: "Telegram-диалог не найден.",
      conversationId: target.id,
      retry: true,
    });
  }
  if (!result.ok) {
    return finishJob(job, "error", {
      renderedMessage,
      errorMessage: result.error || "Telegram не отправил сообщение.",
      messengerMessageId: result.message?.id,
      messengerOutboxId: result.outbox?.id,
      conversationId: target.id,
      retry: true,
    });
  }
  const status: NotificationJobStatus = result.outbox?.status === "skipped" ? "skipped" : "sent";
  return finishJob(job, status, {
    renderedMessage,
    providerMessageId: result.message.channelMessageId ?? null,
    messengerMessageId: result.message.id,
    messengerOutboxId: result.outbox?.id ?? null,
    conversationId: target.id,
  });
}

function eventTitle(eventType: ClientNotificationEventType) {
  return notificationEventDefinitions.find((event) => event.type === eventType)?.title ?? eventType;
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
  if (input.status && ["arrived", "in_work", "client_arrived"].includes(input.status)) {
    events.push(...(await enqueueClientNotificationEvent("client_arrived", input)));
  }
  if (input.status && ["done", "completed", "visit_completed"].includes(input.status)) {
    events.push(...(await enqueueClientNotificationEvent("visit_completed", input)));
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
        criticalCount: map.criticalCount,
        warningCount: map.warningCount,
        payload: { source: "map", shipmentId: map.demandId },
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
    criticalCount: legacy.summaryRed,
    warningCount: legacy.summaryYellow,
    payload: { source: "legacy", shipmentId: legacy.shipmentMoySkladId ?? legacy.shipmentDraftId },
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

export async function listClientNotificationSettings() {
  await ensureClientNotificationsSchema();
  const organizationId = getMessengerOrganizationId();
  const [templates, rules, logs, jobs, channels, kpiRows] = await Promise.all([
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
  ]);
  const telegram = channels.find((channel) => channel.key === "telegram") ?? null;
  const lastSuccess = logs.find((log) => log.status === "sent" || log.status === "delivered");
  return {
    events: notificationEventDefinitions,
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
  const metadata = input.body
    ? {
        variables: [...input.body.matchAll(/\{\{?\s*([a-zA-Z0-9_]+)/g)].map((match) => match[1]),
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
        next_attempt_at = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE organization_id = ${organizationId}
      AND id = ${id}
      AND status IN ('error', 'client_not_connected', 'no_consent', 'skipped', 'sending')
  `;
  return processDueClientNotificationJobs(5);
}
