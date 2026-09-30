import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canViewBranchIntegrationSettings } from "@/lib/integration-access";
import { diagnoseTelegramUserConnection } from "@/lib/messenger/channels/telegram-user-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const lastProbeByBranch = new Map<string, number>();

export async function GET() {
  const auth = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!auth.ok) return auth.response;
  if (!canViewBranchIntegrationSettings(auth.context)) {
    return NextResponse.json({ error: "Диагностика Telegram недоступна для этой роли" }, { status: 403 });
  }
  const branchId = auth.context.branchId!;
  if (Date.now() - (lastProbeByBranch.get(branchId) ?? 0) < 30_000) {
    return NextResponse.json({ error: "Повторите диагностику через 30 секунд" }, { status: 429 });
  }
  lastProbeByBranch.set(branchId, Date.now());
  return runWithBranchApiContext(auth.context, async () => {
    const result = await diagnoseTelegramUserConnection();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } });
  });
}
