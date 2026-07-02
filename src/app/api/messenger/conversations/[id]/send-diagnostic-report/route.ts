import { NextResponse } from "next/server";
import { sendDiagnosticReportFromConversation } from "@/lib/messenger/messenger-context";
import { messengerContextError, readJson, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    const body = await readJson<{ diagnosticId?: string | null; origin?: string | null }>(request);
    const origin = body.origin ?? request.headers.get("origin") ?? new URL(request.url).origin;
    return NextResponse.json(await sendDiagnosticReportFromConversation(id, { ...body, origin }, access.actor));
  } catch (error) {
    return messengerContextError(error);
  }
}

