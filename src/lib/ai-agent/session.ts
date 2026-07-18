import type { Prisma } from "@prisma/client";
import type { AgentInputItem, Session } from "@openai/agents";
import { prisma } from "@/lib/db";

const MAX_SESSION_ITEMS = 120;

function asItems(value: Prisma.JsonValue | null | undefined): AgentInputItem[] {
  return Array.isArray(value) ? (value as unknown as AgentInputItem[]) : [];
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export class PrismaAgentSession implements Session {
  constructor(
    private readonly sessionId: string,
    private readonly organizationId: string
  ) {}

  async getSessionId() {
    return this.sessionId;
  }

  async getItems(limit?: number) {
    const row = await prisma.aIAgentSession.findFirst({
      where: { id: this.sessionId, organizationId: this.organizationId },
      select: { historyJson: true },
    });
    const items = asItems(row?.historyJson);
    const take = limit == null ? items.length : Math.max(0, limit);
    return take >= items.length ? items : items.slice(-take);
  }

  async addItems(items: AgentInputItem[]) {
    if (!items.length) return;
    const current = await this.getItems();
    const next = [...current, ...items].slice(-MAX_SESSION_ITEMS);
    await prisma.aIAgentSession.updateMany({
      where: { id: this.sessionId, organizationId: this.organizationId },
      data: { historyJson: json(next), lastActivityAt: new Date() },
    });
  }

  async popItem() {
    const current = await this.getItems();
    const item = current.pop();
    await prisma.aIAgentSession.updateMany({
      where: { id: this.sessionId, organizationId: this.organizationId },
      data: { historyJson: json(current), lastActivityAt: new Date() },
    });
    return item;
  }

  async clearSession() {
    await prisma.aIAgentSession.updateMany({
      where: { id: this.sessionId, organizationId: this.organizationId },
      data: {
        historyJson: [],
        pendingRunState: null,
        pendingApprovalsJson: [],
        lastDraftText: null,
        lastError: null,
        lastActivityAt: new Date(),
      },
    });
  }
}
