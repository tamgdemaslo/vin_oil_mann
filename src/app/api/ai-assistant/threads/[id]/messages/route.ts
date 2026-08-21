import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAssistantApiError, requireAIAssistantBaseAccess, resolveAIAssistantThreadAccess, runWithAIAssistantBranchContext } from "@/lib/ai-assistant/access";
import { runAssistantThread } from "@/lib/ai-assistant/runner";

export const runtime = "nodejs";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(12_000),
  selectedQuoteId: z.string().trim().min(1).max(160).optional().nullable(),
  quoteSetMessageId: z.string().trim().min(1).max(160).optional().nullable(),
  clientMessageMode: z.enum(["short_with_price", "short_without_price", "detailed_with_price", "only_final_price", "recommendation"]).optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const baseAccess = await requireAIAssistantBaseAccess();
  if ("response" in baseAccess) return baseAccess.response;
  try {
    const { id } = await params;
    const body = messageSchema.parse(await request.json());
    const access = await resolveAIAssistantThreadAccess(baseAccess, id);
    const result = await runWithAIAssistantBranchContext(access, () => runAssistantThread({
      threadId: id,
      organizationId: access.organizationId,
      actor: { id: access.actorId, name: access.session.user.name, role: access.session.user.role },
      message: body.message,
      selectedQuoteId: body.selectedQuoteId,
      quoteSetMessageId: body.quoteSetMessageId,
      clientMessageMode: body.clientMessageMode,
    }));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Введите сообщение до 12 000 символов" }, { status: 422 });
    return aiAssistantApiError(error);
  }
}
