import { NextRequest, NextResponse } from "next/server";
import { linkClientToConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const body = (await request.json().catch(() => null)) as { clientId?: unknown; expectedUpdatedAt?: unknown; vehicle?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId) return NextResponse.json({ error: "Укажите clientId" }, { status: 400 });
  const { id } = await params;
  try {
    const context = await linkClientToConversation(
      id,
      {
        clientId,
        expectedUpdatedAt: typeof body?.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null,
        vehicle: body?.vehicle as never,
      },
      access.actor
    );
    return NextResponse.json({ context });
  } catch (error) {
    return messengerContextError(error);
  }
}
