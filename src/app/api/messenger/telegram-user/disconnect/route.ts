import { NextRequest, NextResponse } from "next/server";
import { disconnectTelegramUserAccount } from "@/lib/messenger/channels/telegram-user-session";
import { requireTelegramOwnerBranchApi } from "@/lib/telegram-user-route-access";
import { runWithBranchApiContext } from "@/lib/branch-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireTelegramOwnerBranchApi();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown };
  try {
    return NextResponse.json(await runWithBranchApiContext(auth.context, () => disconnectTelegramUserAccount(typeof body.accountId === "string" ? body.accountId : "")));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось отключить Telegram" }, { status: 400 });
  }
}
