import { NextResponse } from "next/server";
import { aiAssistantApiError, requireAIAssistantAccess } from "@/lib/ai-assistant/access";
import { getAssistantThread } from "@/lib/ai-assistant/runner";

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
