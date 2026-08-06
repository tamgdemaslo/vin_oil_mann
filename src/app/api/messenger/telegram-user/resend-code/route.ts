import { NextRequest, NextResponse } from "next/server";
import { resendTelegramUserCode } from "@/lib/messenger/channels/telegram-user-session";
import { requireTelegramOwnerBranchApi } from "@/lib/telegram-user-route-access";
import { runWithBranchApiContext } from "@/lib/branch-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireTelegramOwnerBranchApi();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown };
  try {
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    if (!accountId) throw new Error("Не найден Telegram account. Сначала запросите код.");
    const result = await runWithBranchApiContext(auth.context, () => resendTelegramUserCode(accountId));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось повторно запросить код Telegram" }, { status: 400 });
  }
}
