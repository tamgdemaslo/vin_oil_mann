import { NextResponse } from "next/server";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";
import { getConversationAgentStatus } from "@/lib/ai-agent/runner";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAgentAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    return NextResponse.json({ status: await getConversationAgentStatus(access.organizationId, id) });
  } catch (error) {
    return aiAgentApiError(error);
  }
}
