import { NextRequest, NextResponse } from "next/server";
import { createCaseForConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    responsibleLogin?: unknown;
    deadline?: unknown;
    forceNew?: unknown;
  } | null;
  const { id } = await params;
  try {
    const result = await createCaseForConversation(id, {
      title: typeof body?.title === "string" ? body.title : undefined,
      responsibleLogin: typeof body?.responsibleLogin === "string" ? body.responsibleLogin : undefined,
      deadline: typeof body?.deadline === "string" ? body.deadline : undefined,
      forceNew: body?.forceNew === true,
    }, access.actor);
    return NextResponse.json({ case: result.case, context: result.context, alreadyExists: result.alreadyExists }, { status: 201 });
  } catch (error) {
    return messengerContextError(error);
  }
}
