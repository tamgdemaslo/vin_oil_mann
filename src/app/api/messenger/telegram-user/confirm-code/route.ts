import { NextRequest, NextResponse } from "next/server";
import { confirmTelegramUserCode } from "@/lib/messenger/channels/telegram-user-session";
import { requireTelegramOwnerBranchApi } from "@/lib/telegram-user-route-access";
import { runWithBranchApiContext } from "@/lib/branch-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireTelegramOwnerBranchApi();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown; code?: unknown };
  try {
    const result = await runWithBranchApiContext(auth.context, () => confirmTelegramUserCode(
      typeof body.accountId === "string" ? body.accountId : "",
      typeof body.code === "string" ? body.code : ""
    ));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Код Telegram не принят" }, { status: 400 });
  }
}
