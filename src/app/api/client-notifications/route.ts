import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createReminderRule,
  deleteNotificationRule,
  listClientNotificationSettings,
  previewNotificationTemplate,
  processDueClientNotificationJobs,
  retryNotificationJob,
  sendTestNotification,
  updateNotificationRule,
  updateNotificationTemplate,
  type NotificationConditions,
} from "@/lib/client-notifications/client-notifications";

export const dynamic = "force-dynamic";

async function requireNotificationSettingsSession() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  }
  return { session };
}

function bodyRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export async function GET() {
  const auth = await requireNotificationSettingsSession();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await listClientNotificationSettings());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить уведомления" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireNotificationSettingsSession();
  if ("response" in auth) return auth.response;
  const body = bodyRecord(await request.json().catch(() => ({})));
  const kind = stringValue(body.kind);
  try {
    if (kind === "rule") {
      const conditions = body.conditions && typeof body.conditions === "object" ? (body.conditions as NotificationConditions) : undefined;
      const update = {
        id: stringValue(body.id),
        enabled: boolValue(body.enabled),
        templateId: stringValue(body.templateId) || undefined,
        timingType: stringValue(body.timingType) || undefined,
        conditions,
      } as Parameters<typeof updateNotificationRule>[0];
      if ("offsetMinutes" in body) update.offsetMinutes = numberValue(body.offsetMinutes);
      const updated = await updateNotificationRule(update);
      return NextResponse.json({ ok: Boolean(updated), rule: updated });
    }
    if (kind === "template") {
      const updated = await updateNotificationTemplate({
        id: stringValue(body.id),
        name: stringValue(body.name) || undefined,
        body: typeof body.body === "string" ? body.body : undefined,
        isActive: boolValue(body.isActive),
        status: stringValue(body.status) || undefined,
      });
      return NextResponse.json({ ok: Boolean(updated), template: updated });
    }
    return NextResponse.json({ error: "Неизвестный тип обновления" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить настройки" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireNotificationSettingsSession();
  if ("response" in auth) return auth.response;
  const body = bodyRecord(await request.json().catch(() => ({})));
  const action = stringValue(body.action);
  try {
    if (action === "create-reminder") {
      const offsetMinutes = numberValue(body.offsetMinutes) ?? 180;
      const rule = await createReminderRule({ offsetMinutes, templateId: stringValue(body.templateId) || null });
      return NextResponse.json({ ok: Boolean(rule), rule });
    }
    if (action === "delete-rule") {
      return NextResponse.json(await deleteNotificationRule(stringValue(body.id)));
    }
    if (action === "preview") {
      const preview = await previewNotificationTemplate(stringValue(body.templateId) || stringValue(body.body), bodyRecord(body.context));
      return NextResponse.json({ ok: true, preview });
    }
    if (action === "test") {
      const result = await sendTestNotification({
        templateId: stringValue(body.templateId),
        clientId: stringValue(body.clientId) || null,
        clientPhone: stringValue(body.clientPhone) || null,
        clientName: stringValue(body.clientName) || null,
        telegramId: stringValue(body.telegramId) || null,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "process") {
      const processed = await processDueClientNotificationJobs(numberValue(body.limit) ?? 20);
      return NextResponse.json({ ok: true, processed, count: processed.length });
    }
    if (action === "retry") {
      const processed = await retryNotificationJob(stringValue(body.id));
      return NextResponse.json({ ok: true, processed, count: processed.length });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Команда уведомлений не выполнена" }, { status: 500 });
  }
}
