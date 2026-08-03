import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteTelegramWebhook,
  getTelegramWebhookInfo,
  setTelegramWebhook,
} from "@/lib/messenger/channels/telegram";
import { publicTelegramSettings, updateTelegramStoredSettings } from "@/lib/messenger/messenger-channel-settings";
import { pollTelegramUpdates } from "@/lib/messenger/messenger-gateway";

export const dynamic = "force-dynamic";

async function requireIntegrationManager() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  }
  return { session };
}

function telegramActionError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes("messenger_channel_settings")) {
      return "Миграция Messenger Gateway не применена к базе данных: отсутствует таблица messenger_channel_settings.";
    }
    if (message.includes("database") || message.includes("Prisma") || message.includes("relation") || message.includes("column")) {
      return "Ошибка базы данных при сохранении Telegram-настроек. Проверьте миграции Messenger Gateway.";
    }
    return message;
  }
  return "Неизвестная ошибка Telegram Gateway.";
}

export async function GET() {
  const auth = await requireIntegrationManager();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await getTelegramWebhookInfo());
}

export async function POST(request: NextRequest) {
  const auth = await requireIntegrationManager();
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as {
    action?: "setWebhook" | "deleteWebhook" | "poll" | "saveSettings";
    dropPendingUpdates?: boolean;
    offset?: number;
    limit?: number;
    timeout?: number;
    enabled?: unknown;
    dryRun?: unknown;
    botUsername?: unknown;
    webhookUrl?: unknown;
    webhookSecret?: unknown;
    botToken?: unknown;
  };

  if (body.action === "saveSettings") {
    try {
      const settings = await updateTelegramStoredSettings({
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        dryRun: typeof body.dryRun === "boolean" ? body.dryRun : undefined,
        botUsername: typeof body.botUsername === "string" ? body.botUsername : undefined,
        webhookUrl: typeof body.webhookUrl === "string" ? body.webhookUrl : undefined,
        webhookSecret: typeof body.webhookSecret === "string" ? body.webhookSecret : undefined,
        botToken: typeof body.botToken === "string" ? body.botToken : undefined,
        updatedById: auth.session.user.login,
      });
      return NextResponse.json({ ok: true, config: publicTelegramSettings(settings) });
    } catch (error) {
      return NextResponse.json({ ok: false, error: telegramActionError(error) }, { status: 500 });
    }
  }
  if (body.action === "setWebhook") {
    return NextResponse.json(await setTelegramWebhook({ dropPendingUpdates: body.dropPendingUpdates }));
  }
  if (body.action === "deleteWebhook") {
    return NextResponse.json(await deleteTelegramWebhook({ dropPendingUpdates: body.dropPendingUpdates }));
  }
  if (body.action === "poll") {
    return NextResponse.json(
      await pollTelegramUpdates({
        offset: body.offset,
        limit: body.limit,
        timeout: body.timeout,
      })
    );
  }
  return NextResponse.json({ ok: false, error: "Unknown Telegram action" }, { status: 400 });
}
