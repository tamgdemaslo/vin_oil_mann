import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";
import { assertSafeAgentOutput } from "@/lib/ai-agent/security";
import { sendMessage } from "@/lib/messenger/messenger-gateway";

const bodySchema = z.object({ text: z.string().trim().min(1).max(12_000).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAgentAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    const session = await prisma.aIAgentSession.findFirst({ where: { organizationId: access.organizationId, conversationId: id } });
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const text = body.text?.trim() || session?.lastDraftText?.trim();
    if (!session || !text) return NextResponse.json({ error: "Черновик отсутствует" }, { status: 404 });
    assertSafeAgentOutput(text);
    const sent = await sendMessage({ conversationId: id, text, createdByLogin: access.actorId });
    if (!sent?.ok) throw new Error(sent?.error || "Мессенджер не подтвердил отправку");
    await Promise.all([
      prisma.aIAgentSession.update({ where: { id: session.id }, data: { status: "waiting_client", lastDraftText: text, lastActivityAt: new Date() } }),
      prisma.aIServiceQuote.updateMany({ where: { organizationId: access.organizationId, conversationId: id, status: "approved" }, data: { status: "sent", sentAt: new Date() } }),
    ]);
    return NextResponse.json({ ok: true, message: sent.message });
  } catch (error) {
    return aiAgentApiError(error);
  }
}
