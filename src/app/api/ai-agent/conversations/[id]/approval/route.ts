import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";
import { resolveAgentApproval } from "@/lib/ai-agent/runner";

const bodySchema = z.object({ approvalId: z.string().min(1).max(200), approved: z.boolean() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAgentAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    const input = bodySchema.parse(await request.json());
    return NextResponse.json(await resolveAgentApproval({ organizationId: access.organizationId, conversationId: id, actorId: access.actorId, approvalId: input.approvalId, approved: input.approved }));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Некорректное подтверждение" }, { status: 422 });
    return aiAgentApiError(error);
  }
}
