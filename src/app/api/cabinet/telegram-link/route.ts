import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext, type BranchContext } from "@/lib/branch-context";
import {
  createEmployeeTelegramLinkToken,
  getEmployeeTelegramStatus,
} from "@/lib/messenger/messenger-linking";
import { runWithRequestTenant } from "@/lib/request-tenant-store";

export const dynamic = "force-dynamic";

async function requireConcreteBranch() {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    if (context.mode !== "branch" || !context.branchId) {
      return {
        response: NextResponse.json(
          { error: "Для настройки Telegram выберите конкретный филиал.", code: "concrete_branch_required" },
          { status: 409 },
        ),
      };
    }
    return { context };
  } catch (error) {
    const result = branchErrorResponse(error);
    return { response: NextResponse.json({ error: result.error, code: result.code }, { status: result.status }) };
  }
}

function withBranch<T>(context: BranchContext, operation: () => T) {
  return runWithRequestTenant({
    mode: "branch",
    branchId: context.branchId,
    organizationId: context.organizationId,
    allowedBranchIds: context.branchId ? [context.branchId] : [],
    businessGroupId: context.businessGroupId,
    userId: context.userId,
    permissions: context.permissions,
  }, operation);
}

function telegramLinkError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие Telegram";
  if (message.includes("messenger_connections") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  const access = await requireConcreteBranch();
  if ("response" in access) return access.response;
  try {
    const telegram = await withBranch(access.context, () => getEmployeeTelegramStatus(access.context.user.login));
    return NextResponse.json({ telegram, branchId: access.context.branchId });
  } catch (error) {
    return telegramLinkError(error);
  }
}

export async function POST() {
  const access = await requireConcreteBranch();
  if ("response" in access) return access.response;

  try {
    const { linked, token } = await withBranch(access.context, async () => ({
      linked: await getEmployeeTelegramStatus(access.context.user.login),
      token: await createEmployeeTelegramLinkToken({
        employeeId: access.context.user.login,
        createdById: access.context.user.login,
      }),
    }));
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
