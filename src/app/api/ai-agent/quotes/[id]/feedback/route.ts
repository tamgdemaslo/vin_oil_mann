import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";

const bodySchema = z.object({
  code: z.enum(["all_correct", "corrected_product", "corrected_volume", "corrected_approval", "corrected_price", "dangerous_error", "good_consultation", "good_sale"]),
  note: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAgentAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const quote = await prisma.aIServiceQuote.findFirst({ where: { id, organizationId: access.organizationId }, select: { id: true, conversationId: true } });
    if (!quote) return NextResponse.json({ error: "Расчёт не найден" }, { status: 404 });
    const feedback = await prisma.aIAgentQualityFeedback.create({ data: { organizationId: access.organizationId, quoteId: quote.id, conversationId: quote.conversationId, code: body.code, note: body.note || null, createdById: access.actorId } });
    return NextResponse.json({ feedback: { id: feedback.id, code: feedback.code, createdAt: feedback.createdAt.toISOString() } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Некорректная оценка" }, { status: 422 });
    return aiAgentApiError(error);
  }
}
