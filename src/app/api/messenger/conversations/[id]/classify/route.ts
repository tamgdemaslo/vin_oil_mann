import { NextResponse } from "next/server";
import { classifyConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, readJson, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    const body = await readJson<{ type?: string; expectedUpdatedAt?: string | null }>(request);
    const type = body.type === "supplier" || body.type === "employee" || body.type === "client" ? body.type : "unknown";
    return NextResponse.json({ context: await classifyConversation(id, { type, expectedUpdatedAt: body.expectedUpdatedAt }, access.actor) });
  } catch (error) {
    return messengerContextError(error);
  }
}

