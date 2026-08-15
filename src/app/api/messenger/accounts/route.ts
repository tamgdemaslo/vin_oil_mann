import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listTelegramUserAccounts } from "@/lib/messenger/channels/telegram-user-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;
  if (branchAccess.context.user.role !== "owner" && branchAccess.context.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return runWithBranchApiContext(branchAccess.context, async () => {
    const telegram = await listTelegramUserAccounts();
    return NextResponse.json({ accounts: telegram });
  });
}
