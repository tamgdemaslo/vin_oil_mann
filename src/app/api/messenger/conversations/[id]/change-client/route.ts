import { NextResponse } from "next/server";
import { linkClientToConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, readJson, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    const body = await readJson<{ clientId?: string; expectedUpdatedAt?: string | null; vehicle?: unknown }>(request);
    if (!body.clientId?.trim()) return NextResponse.json({ error: "Укажите clientId" }, { status: 400 });
    return NextResponse.json({
      context: await linkClientToConversation(id, {
        clientId: body.clientId.trim(),
        expectedUpdatedAt: body.expectedUpdatedAt,
        vehicle: body.vehicle as never,
      }, access.actor),
    });
  } catch (error) {
    return messengerContextError(error);
  }
}

