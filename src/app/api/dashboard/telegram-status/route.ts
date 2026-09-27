import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getActiveTelegramUserAccount } from "@/lib/messenger/channels/telegram-user-session";
import { canViewBranchIntegrationSettings } from "@/lib/integration-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    try {
      const account = await getActiveTelegramUserAccount();
      const connected = Boolean(account?.isActive && account.status === "connected");
      return NextResponse.json({
        connected,
        status: account?.status ?? "not_connected",
        branchName: access.context.branch?.shortName || access.context.branch?.name || "Текущий филиал",
        canManage: canViewBranchIntegrationSettings(access.context),
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({
        connected: false,
        status: "error",
        branchName: access.context.branch?.shortName || access.context.branch?.name || "Текущий филиал",
        canManage: canViewBranchIntegrationSettings(access.context),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
  });
}
