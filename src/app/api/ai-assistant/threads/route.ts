import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAssistantApiError, requireAIAssistantAccess, runWithAIAssistantBranchContext } from "@/lib/ai-assistant/access";
import { createAssistantThread, listAssistantThreads } from "@/lib/ai-assistant/runner";

export const runtime = "nodejs";

const createSchema = z.object({ title: z.string().trim().max(120).optional(), branchId: z.string().trim().min(1).max(160).optional() });

export async function GET() {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const [threads, archivedThreads] = await runWithAIAssistantBranchContext(access, () => Promise.all([
      listAssistantThreads(access.organizationId),
      listAssistantThreads(access.organizationId, "archived"),
    ]));
    return NextResponse.json({
      threads,
      archivedThreads,
      branch: { id: access.branchId, name: access.branchName },
    });
  } catch (error) {
    return aiAssistantApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json().catch(() => ({})));
    const access = await requireAIAssistantAccess(body.branchId);
    if ("response" in access) return access.response;
    const thread = await runWithAIAssistantBranchContext(access, () => createAssistantThread({ organizationId: access.organizationId, actor: { id: access.actorId, name: access.session.user.name, role: access.session.user.role }, title: body.title }));
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Некорректное название диалога" }, { status: 422 });
    return aiAssistantApiError(error);
  }
}
