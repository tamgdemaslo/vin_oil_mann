import { NextResponse } from "next/server";
import { linkCaseToConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, readJson, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    const body = await readJson<{ caseId?: string }>(request);
    if (!body.caseId?.trim()) return NextResponse.json({ error: "Укажите caseId" }, { status: 400 });
    return NextResponse.json(await linkCaseToConversation(id, { caseId: body.caseId.trim() }, access.actor));
  } catch (error) {
    return messengerContextError(error);
  }
}

