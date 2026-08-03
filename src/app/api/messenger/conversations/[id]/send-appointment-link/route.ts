import { NextResponse } from "next/server";
import { sendAppointmentLinkFromConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    return NextResponse.json(await sendAppointmentLinkFromConversation(id, access.actor));
  } catch (error) {
    return messengerContextError(error);
  }
}

