import { NextResponse } from "next/server";
import { aiAssistantApiError, requireAIAssistantBaseAccess, resolveAIAssistantThreadAccess, runWithAIAssistantBranchContext } from "@/lib/ai-assistant/access";
import { cancelAssistantRun } from "@/lib/ai-assistant/runner";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const baseAccess = await requireAIAssistantBaseAccess();
  if ("response" in baseAccess) return baseAccess.response;
  try {
    const { id } = await params;
    const access = await resolveAIAssistantThreadAccess(baseAccess, id);
    return NextResponse.json(await runWithAIAssistantBranchContext(access, () => cancelAssistantRun({ threadId: id, organizationId: access.organizationId })));
  } catch (error) {
    return aiAssistantApiError(error);
  }
}
