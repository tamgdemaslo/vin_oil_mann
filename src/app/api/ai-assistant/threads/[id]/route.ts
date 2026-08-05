import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAssistantApiError, requireAIAssistantAccess } from "@/lib/ai-assistant/access";
import { getAssistantThread, setAssistantThreadStatus } from "@/lib/ai-assistant/runner";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    return NextResponse.json(await getAssistantThread(id, access.organizationId));
  } catch (error) {
    return aiAssistantApiError(error);
  }
}

const statusSchema = z.object({ status: z.enum(["active", "archived"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    const body = statusSchema.parse(await request.json());
    const thread = await setAssistantThreadStatus({ threadId: id, organizationId: access.organizationId, status: body.status });
    return NextResponse.json({ thread });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Некорректный статус диалога" }, { status: 422 });
    return aiAssistantApiError(error);
  }
}
