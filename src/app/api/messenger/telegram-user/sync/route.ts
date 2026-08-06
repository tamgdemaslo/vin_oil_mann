import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { syncTelegramUserConversations } from "@/lib/messenger/messenger-gateway";
import { canViewBranchIntegrationSettings } from "@/lib/integration-access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;
  if (!canViewBranchIntegrationSettings(branchAccess.context)) {
    return NextResponse.json({ error: "Проверка рабочего Telegram недоступна для этой роли" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown; limit?: unknown; force?: unknown };
  return runWithBranchApiContext(branchAccess.context, async () => {
    try {
      const result = await syncTelegramUserConversations({
        accountId: typeof body.accountId === "string" ? body.accountId : undefined,
        limit: typeof body.limit === "number" ? body.limit : undefined,
        force: body.force === true,
      });
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось синхронизировать Telegram" }, { status: 400 });
    }
  });
}
