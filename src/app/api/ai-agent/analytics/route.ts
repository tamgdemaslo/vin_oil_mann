import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";

function boundedDays(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(365, Math.max(1, Math.round(parsed))) : 30;
}

export async function GET(request: Request) {
  const access = await requireAIAgentAccess({ manage: true });
  if ("response" in access) return access.response;
  try {
    const days = boundedDays(new URL(request.url).searchParams.get("days"));
    const since = new Date(Date.now() - days * 86_400_000);
    const runWhere = { organizationId: access.organizationId, createdAt: { gte: since } };
    const quoteWhere = { organizationId: access.organizationId, createdAt: { gte: since } };
    const handoffWhere = { organizationId: access.organizationId, createdAt: { gte: since } };
    const toolWhere = { organizationId: access.organizationId, startedAt: { gte: since } };

    const [
      runs,
      completedRuns,
      failedRuns,
      runStats,
      conversations,
      quotes,
      appointments,
      handoffs,
      handoffConversations,
      handoffReasons,
      rosskoCalls,
      failedSelectionCalls,
      recentErrors,
    ] = await Promise.all([
      prisma.aIAgentRun.count({ where: runWhere }),
      prisma.aIAgentRun.count({ where: { ...runWhere, status: "completed" } }),
      prisma.aIAgentRun.count({ where: { ...runWhere, status: "failed" } }),
      prisma.aIAgentRun.aggregate({ where: runWhere, _avg: { durationMs: true }, _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true } }),
      prisma.aIAgentRun.groupBy({ by: ["conversationId"], where: runWhere }),
      prisma.aIServiceQuote.count({ where: quoteWhere }),
      prisma.aIServiceQuote.count({ where: { ...quoteWhere, status: "converted_to_appointment" } }),
      prisma.aIAgentHandoff.count({ where: handoffWhere }),
      prisma.aIAgentHandoff.groupBy({ by: ["conversationId"], where: handoffWhere }),
      prisma.aIAgentHandoff.groupBy({ by: ["reasonCode"], where: handoffWhere, _count: { _all: true }, orderBy: { _count: { reasonCode: "desc" } }, take: 10 }),
      prisma.aIAgentToolCall.count({ where: { ...toolWhere, toolName: "rossko_search" } }),
      prisma.aIAgentToolCall.count({ where: { ...toolWhere, status: "failed", toolName: { in: ["resolve_vehicle_by_vin", "get_engine_oil_requirements", "find_required_parts", "search_local_catalog"] } } }),
      prisma.aIAgentRun.findMany({ where: { ...runWhere, status: "failed" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, conversationId: true, intent: true, errorMessage: true, createdAt: true } }),
    ]);

    const conversationCount = conversations.length;
    const handoffConversationCount = handoffConversations.length;
    const percentage = (value: number, total: number) => total ? Math.round((value / total) * 1000) / 10 : 0;

    return NextResponse.json({
      period: { days, since: since.toISOString() },
      metrics: {
        conversations: conversationCount,
        runs,
        completedRuns,
        failedRuns,
        handledWithoutHumanRate: percentage(Math.max(0, conversationCount - handoffConversationCount), conversationCount),
        handoffRate: percentage(handoffConversationCount, conversationCount),
        quotes,
        appointments,
        dialogToQuoteRate: percentage(quotes, conversationCount),
        quoteToAppointmentRate: percentage(appointments, quotes),
        averageResponseMs: Math.round(runStats._avg.durationMs ?? 0),
        inputTokens: runStats._sum.inputTokens ?? 0,
        outputTokens: runStats._sum.outputTokens ?? 0,
        estimatedCostMicros: runStats._sum.estimatedCostMicros ?? 0,
        handoffs,
        rosskoCalls,
        failedSelectionCalls,
      },
      handoffReasons: handoffReasons.map((row) => ({ reasonCode: row.reasonCode, count: row._count._all })),
      recentErrors: recentErrors.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  } catch (error) {
    return aiAgentApiError(error);
  }
}
