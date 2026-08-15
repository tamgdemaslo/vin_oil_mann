import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { retryMessageOutbox } from "@/lib/messenger/messenger-outbox";

function messengerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось повторить отправку сообщения";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;
  const { id, messageId } = await params;
  return runWithBranchApiContext(branchAccess.context, async () => {
    try {
      const outbox = await retryMessageOutbox({ conversationId: id, messageId });
      return NextResponse.json({ ok: outbox.status !== "failed", outbox });
    } catch (error) {
      return messengerError(error);
    }
  });
}
