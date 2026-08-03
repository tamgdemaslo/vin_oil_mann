import QRCode from "qrcode";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLocalAdminCounterparty } from "@/lib/local-inventory-admin";
import { requireBranchApi } from "@/lib/branch-api";
import {
  createClientTelegramLinkToken,
  getClientTelegramStatus,
} from "@/lib/messenger/messenger-linking";

export const dynamic = "force-dynamic";

async function requireSession() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return { response: branchAccess.response };
  return { session, branchId: branchAccess.context.branchId! };
}

async function requireCounterparty(id: string, branchId: string) {
  const result = await getLocalAdminCounterparty(id, branchId);
  if (!result.ok) {
    return { response: NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 }) };
  }
  if (result.counterparty.source !== "local") {
    return { response: NextResponse.json({ error: "Сначала сохраните клиента в CRM" }, { status: 400 }) };
  }
  return { counterparty: result.counterparty };
}

function telegramLinkError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие Telegram";
  if (message.includes("messenger_connections") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const gate = await requireCounterparty(id, auth.branchId);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json({ telegram: await getClientTelegramStatus(gate.counterparty.id) });
  } catch (error) {
    return telegramLinkError(error);
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const gate = await requireCounterparty(id, auth.branchId);
  if ("response" in gate) return gate.response;

  try {
    const linked = await getClientTelegramStatus(gate.counterparty.id);
    const token = await createClientTelegramLinkToken({
      clientId: gate.counterparty.id,
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
