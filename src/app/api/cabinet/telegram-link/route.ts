import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createEmployeeTelegramLinkToken,
  getEmployeeTelegramStatus,
} from "@/lib/messenger/messenger-linking";

export const dynamic = "force-dynamic";

async function requireSession() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  return { session };
}

function telegramLinkError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие Telegram";
  if (message.includes("messenger_connections") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ telegram: await getEmployeeTelegramStatus(auth.session.user.login) });
  } catch (error) {
    return telegramLinkError(error);
  }
}

export async function POST() {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;

  try {
    const linked = await getEmployeeTelegramStatus(auth.session.user.login);
    const token = await createEmployeeTelegramLinkToken({
      employeeId: auth.session.user.login,
      createdById: auth.session.user.login,
    });
    if (!token.linkUrl) {
      return NextResponse.json(
        {
          error: "Telegram bot username не настроен. Откройте Кабинет → Интеграции → Мессенджеры и сохраните настройки Telegram.",
          code: "telegram_not_configured",
          settingsUrl: "/cabinet/integrations/messenger",
        },
        { status: 400 }
      );
    }
    const qrDataUrl = await QRCode.toDataURL(token.linkUrl, { margin: 1, width: 220 });
    return NextResponse.json({
      telegram: linked,
      link: {
        token: token.token,
        linkUrl: token.linkUrl,
        qrDataUrl,
        expiresAt: token.expiresAt,
      },
    });
  } catch (error) {
    return telegramLinkError(error);
  }
}
