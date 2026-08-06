import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAssistantApiError, requireAIAssistantBaseAccess, resolveAIAssistantThreadAccess, runWithAIAssistantBranchContext } from "@/lib/ai-assistant/access";
import { getAssistantThread, setAssistantThreadStatus } from "@/lib/ai-assistant/runner";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const baseAccess = await requireAIAssistantBaseAccess();
  if ("response" in baseAccess) return baseAccess.response;
  try {
    const { id } = await params;
    const access = await resolveAIAssistantThreadAccess(baseAccess, id);
    const payload = await runWithAIAssistantBranchContext(access, () => getAssistantThread(id, access.organizationId));
    return NextResponse.json({ ...payload, branch: { id: access.branchId, name: access.branchName } });
  } catch (error) {
    return aiAssistantApiError(error);
  }
}

const statusSchema = z.object({ status: z.enum(["active", "archived"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const baseAccess = await requireAIAssistantBaseAccess();
  if ("response" in baseAccess) return baseAccess.response;
  try {
    const { id } = await params;
    const body = statusSchema.parse(await request.json());
    const access = await resolveAIAssistantThreadAccess(baseAccess, id);
    const thread = await runWithAIAssistantBranchContext(access, () => setAssistantThreadStatus({ threadId: id, organizationId: access.organizationId, status: body.status }));
    return NextResponse.json({ thread });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Некорректный статус диалога" }, { status: 422 });
    return aiAssistantApiError(error);
  }
}
