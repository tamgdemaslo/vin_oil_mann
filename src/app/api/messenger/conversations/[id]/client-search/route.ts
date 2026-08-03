import { NextResponse } from "next/server";
import { searchMessengerClients } from "@/lib/messenger/messenger-context";
import { messengerContextError, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  void (await params);
  const searchParams = new URL(request.url).searchParams;
  try {
    return NextResponse.json({ clients: await searchMessengerClients(searchParams.get("q") ?? "", 12) });
  } catch (error) {
    return messengerContextError(error);
  }
}

