import { NextResponse } from "next/server";
import { createAndLinkClient } from "@/lib/messenger/messenger-context";
import { messengerContextError, readJson, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    const body = await readJson(request);
    return NextResponse.json({ context: await createAndLinkClient(id, body, access.actor) }, { status: 201 });
  } catch (error) {
    return messengerContextError(error);
  }
}

