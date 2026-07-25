import { NextResponse } from "next/server";
import { aiAssistantApiError, requireAIAssistantAccess } from "@/lib/ai-assistant/access";
import { cancelAssistantRun } from "@/lib/ai-assistant/runner";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    return NextResponse.json(await cancelAssistantRun({ threadId: id, organizationId: access.organizationId }));
  } catch (error) {
    return aiAssistantApiError(error);
  }
}
