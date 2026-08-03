import { NextResponse } from "next/server";
import { unlinkClientFromConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    return NextResponse.json({ context: await unlinkClientFromConversation(id, access.actor) });
  } catch (error) {
    return messengerContextError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return DELETE(request, context);
}
