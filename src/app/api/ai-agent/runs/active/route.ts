import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";
import { getAgentSettings } from "@/lib/ai-agent/settings";
import { runTimeoutState } from "@/lib/ai-agent/run-progress";

/** Lightweight activity map for the conversation list; it deliberately does
 * not expose prompts, tool arguments, client data or model reasoning. */
export async function GET() {
  const access = await requireAIAgentAccess();
  if ("response" in access) return access.response;
  try {
    const settings = await getAgentSettings(access.organizationId);
    const runs = await prisma.aIAgentRun.findMany({
      where: { organizationId: access.organizationId, status: { in: ["queued", "running", "waiting_for_human"] } },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: { id: true, conversationId: true, status: true, stageLabel: true, startedAt: true, heartbeatAt: true, requiresHumanApproval: true },
    });
    const activeActivities = runs.map((run) => {
        const timeout = runTimeoutState(settings, run.startedAt, run.heartbeatAt);
        return {
          conversationId: run.conversationId,
          runId: run.id,
          status: run.status,
          stageLabel: run.stageLabel,
          elapsedSeconds: timeout.elapsedSeconds,
          stale: timeout.stale,
          requiresHumanApproval: run.requiresHumanApproval,
        };
      });
    const activeConversationIds = new Set(runs.map((run) => run.conversationId));
    const sessions = await prisma.aIAgentSession.findMany({
      where: {
        organizationId: access.organizationId,
        conversationId: { notIn: [...activeConversationIds] },
        status: { in: ["waiting_client", "handoff", "human", "error"] },
      },
      select: { conversationId: true, status: true, lastActivityAt: true },
      take: 100,
    });
    return NextResponse.json({
      activities: [
        ...activeActivities,
        ...sessions.map((session) => ({
          conversationId: session.conversationId,
          runId: `session:${session.conversationId}`,
          status: session.status === "waiting_client" ? "waiting_for_client" : session.status === "handoff" || session.status === "human" ? "handed_off" : "failed",
          stageLabel: null,
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - session.lastActivityAt.getTime()) / 1000)),
          stale: false,
          requiresHumanApproval: false,
        })),
      ],
    });
  } catch (error) {
    return aiAgentApiError(error);
  }
}
