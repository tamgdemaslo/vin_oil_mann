import { NextResponse } from "next/server";
import { suggestMessengerClients } from "@/lib/messenger/messenger-context";
import { messengerContextError, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    return NextResponse.json({ suggestions: await suggestMessengerClients(id) });
  } catch (error) {
    return messengerContextError(error);
  }
}

