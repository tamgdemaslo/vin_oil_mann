import { prisma } from "@/lib/db";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationId } from "./messenger-tenant";
import type { MessageTemplate, MessengerChannel } from "./messenger-types";
import { getScopedBranchId } from "@/lib/request-tenant-store";

type TemplateRow = {
  id: string;
  key: string;
  title: string;
  channel: MessengerChannel | null;
  text: string;
  variablesJson: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const defaultMessageTemplates: MessageTemplate[] = [
  { id: "tpl-hello", key: "hello", title: "Здравствуйте", channel: null, text: "Здравствуйте!", variablesJson: [], isActive: true },
  {
    id: "tpl-diagnostic-report",
    key: "diagnostic_report",
    title: "Отчёт диагностики",
    channel: null,
    text: "Диагностика готова\n\n{{clientName}}, диагностика {{vehicleName}} готова.\n\nПроверено {{checkedCount}} пунктов.\n{{recommendationText}}\n{{criticalText}}\n\nОткрыть отчёт: {{reportUrl}}",
    variablesJson: ["clientName", "vehicleName", "checkedCount", "recommendationText", "criticalText", "reportUrl"],
    isActive: true,
  },
  {
    id: "tpl-appointment-confirm",
    key: "appointment_confirm",
    title: "Подтверждение записи",
    channel: null,
    text: "Здравствуйте, {{clientName}}!\nВы записаны на {{date}} в {{time}}.\n\nАвтомобиль: {{vehicleName}}\nУслуга: {{serviceName}}",
    variablesJson: ["clientName", "date", "time", "vehicleName", "serviceName"],
    isActive: true,
  },
  {
    id: "tpl-need-vin",
    key: "need_vin",
    title: "Нужен VIN",
    channel: null,
    text: "Подскажите, пожалуйста, VIN или госномер автомобиля — так мы точнее подберём расходники.",
    variablesJson: [],
    isActive: true,
  },
  {
    id: "tpl-estimate-ready",
    key: "estimate_ready",
    title: "Расчёт готов",
    channel: null,
    text: "Расчёт готов:\n{{summary}}\n\nИтого: {{amount}} ₽",
    variablesJson: ["summary", "amount"],
    isActive: true,
  },
  {
    id: "tpl-task-assigned",
    key: "task_assigned",
    title: "Назначена задача",
    channel: null,
    text: "Вам назначена задача:\n{{taskTitle}}\n\nСрок: {{dueAt}}",
    variablesJson: ["taskTitle", "dueAt"],
    isActive: true,
  },
  {
    id: "tpl-case-overdue",
    key: "case_overdue",
    title: "Просрочено дело",
    channel: null,
    text: "Просрочено дело клиента:\n{{caseTitle}}\n\nКлиент: {{clientName}}\nСрок: {{dueAt}}",
    variablesJson: ["caseTitle", "clientName", "dueAt"],
    isActive: true,
  },
  {
    id: "tpl-appointment-today-summary",
    key: "appointment_today_summary",
    title: "Сводка записей на сегодня",
    channel: null,
    text: "Сводка записей на сегодня:\n{{summary}}",
    variablesJson: ["summary"],
    isActive: true,
  },
  { id: "tpl-vin", key: "vin_request", title: "Запрос VIN", channel: null, text: "Подскажите VIN, пожалуйста", variablesJson: [], isActive: true },
  { id: "tpl-record", key: "appointment_offer", title: "Запись", channel: null, text: "Можем записать вас на удобное время", variablesJson: [], isActive: true },
  { id: "tpl-stock-ok", key: "stock_available", title: "В наличии", channel: null, text: "Расходники есть в наличии", variablesJson: [], isActive: true },
  { id: "tpl-stock-wait", key: "stock_waiting", title: "Ожидаются", channel: null, text: "Расходники ожидаются", variablesJson: [], isActive: true },
  { id: "tpl-thanks", key: "thanks_waiting", title: "Спасибо", channel: null, text: "Спасибо, будем ждать", variablesJson: [], isActive: true },
  { id: "tpl-welcome-back", key: "welcome_back", title: "Обращайтесь", channel: null, text: "Хорошо, обращайтесь", variablesJson: [], isActive: true },
];

export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  try {
    await ensureMessengerIntegrationCoreSchema();
    const organizationId = getMessengerOrganizationId();
    const branchId = getScopedBranchId();
    const rows = await prisma.$queryRaw<TemplateRow[]>`
      SELECT
        id,
        key,
        title,
        channel,
        text,
        variables_json AS "variablesJson",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM messenger_templates
      WHERE organization_id = ${organizationId}
        AND branch_id = ${branchId}
        AND is_active = true
      ORDER BY title ASC
    `;
    return rows.length
      ? rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))
      : defaultMessageTemplates;
  } catch {
    return defaultMessageTemplates;
  }
}
