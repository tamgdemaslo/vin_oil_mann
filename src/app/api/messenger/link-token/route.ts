import QRCode from "qrcode";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createClientTelegramLinkToken,
  createEmployeeTelegramLinkToken,
} from "@/lib/messenger/messenger-linking";

export const dynamic = "force-dynamic";

function messengerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось создать link-token";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    channel?: unknown;
    type?: unknown;
    clientId?: unknown;
    employeeId?: unknown;
    ttlMinutes?: unknown;
  } | null;
  const input = body ?? {};
  const channel = input.channel === undefined ? "telegram" : input.channel;
  if (channel !== "telegram") return NextResponse.json({ error: "Пока link-token поддерживает только Telegram" }, { status: 400 });

  const type = input.type;
  const ttlMinutes = typeof input.ttlMinutes === "number" ? input.ttlMinutes : undefined;

  if (type === "client") {
    const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
    if (!clientId) return NextResponse.json({ error: "Укажите clientId" }, { status: 400 });
    try {
      const token = await createClientTelegramLinkToken({ clientId, createdById: session.user.login, ttlMinutes });
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
      return NextResponse.json({ link: { ...token, qrDataUrl, type: "client", channel: "telegram" } }, { status: 201 });
    } catch (error) {
      return messengerError(error);
    }
  }

  if (type === "employee") {
    const requestedEmployeeId = typeof input.employeeId === "string" && input.employeeId.trim() ? input.employeeId.trim() : session.user.login;
    const canCreateForOther = session.user.role === "owner" || session.user.role === "admin";
    if (requestedEmployeeId !== session.user.login && !canCreateForOther) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }
    try {
      const token = await createEmployeeTelegramLinkToken({
        employeeId: requestedEmployeeId,
        createdById: session.user.login,
        ttlMinutes,
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
      return NextResponse.json({ link: { ...token, qrDataUrl, type: "employee", channel: "telegram" } }, { status: 201 });
    } catch (error) {
      return messengerError(error);
    }
  }

  return NextResponse.json({ error: "Укажите type: client или employee" }, { status: 400 });
}
