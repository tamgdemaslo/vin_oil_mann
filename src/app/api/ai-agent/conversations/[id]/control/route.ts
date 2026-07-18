import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";
import { setConversationAgentControl } from "@/lib/ai-agent/runner";

const bodySchema = z.object({ action: z.enum(["takeover", "return", "stop"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAgentAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    const input = bodySchema.parse(await request.json());
    return NextResponse.json(await setConversationAgentControl({ organizationId: access.organizationId, conversationId: id, actorId: access.actorId, action: input.action }));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Неизвестное действие" }, { status: 422 });
    return aiAgentApiError(error);
  }
}
