import type { Prisma } from "@prisma/client";
import type { AgentInputItem, Session } from "@openai/agents";
import { prisma } from "@/lib/db";

// Tool payloads (catalogue search, VIN lookup, technical evidence) are useful
// during the current run, but should not be replayed on every later message.
// A reasoning-model response, however, is an atomic chain: reasoning, calls,
// outputs and the final assistant message must travel together. Keeping only
// `message` records left orphaned assistant messages and Responses rejected the
// next turn with "message was provided without its required reasoning item".
const MAX_SESSION_TURN_CHARS = 9_000;
const MAX_SINGLE_CLIENT_MESSAGE_CHARS = 3_000;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function serializedLength(value: unknown) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function itemRecord(item: AgentInputItem) {
  return item && typeof item === "object" ? item as unknown as Record<string, unknown> : {};
}

function isUserMessage(item: AgentInputItem) {
  const value = itemRecord(item);
  return value.type === "message" && value.role === "user";
}

function isAssistantMessage(item: AgentInputItem) {
  if (!item || typeof item !== "object") return false;
  const value = itemRecord(item);
  return value.type === "message" && value.role === "assistant";
}

function isReasoningItem(item: AgentInputItem) {
  return itemRecord(item).type === "reasoning";
}

function textFromUserMessage(item: AgentInputItem) {
  const content = itemRecord(item).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const row = part && typeof part === "object" ? part as Record<string, unknown> : {};
      return row.type === "input_text" && typeof row.text === "string" ? row.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function plainUserMessage(item: AgentInputItem): AgentInputItem | null {
  const text = textFromUserMessage(item);
  if (!text || text.length > MAX_SINGLE_CLIENT_MESSAGE_CHARS) return null;
  // Re-create a plain user item without provider-issued IDs or metadata. It is
  // deliberately independent from a previous model response.
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  } as AgentInputItem;
}

/**
 * Keep one complete model turn. Earlier context is represented by the durable
 * ConversationAgentState and typed tools; replaying older raw tool JSON is not
 * required. If the last turn is too large or was saved by an older broken
 * version without its reasoning item, retain only its independent client text.
 */
export function compactAgentSessionHistory(items: AgentInputItem[]) {
  const lastUserIndex = items.map(isUserMessage).lastIndexOf(true);
  if (lastUserIndex < 0) return [];
  const latestTurn = items.slice(lastUserIndex);
  const latestUser = latestTurn[0];
  const turnSize = serializedLength(latestTurn);
  const hasAssistantOutput = latestTurn.some(isAssistantMessage);
  const hasReasoning = latestTurn.some(isReasoningItem);

  // A historic session may already contain the damaged message-only record.
  // Never replay it: fall back to a clean client item so the next run repairs
  // the session instead of repeating the 400 error.
  if (!Number.isFinite(turnSize) || turnSize > MAX_SESSION_TURN_CHARS || (hasAssistantOutput && !hasReasoning)) {
    const safeUser = plainUserMessage(latestUser);
    return safeUser ? [safeUser] : [];
  }
  return latestTurn;
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
    // CRM messages are replayed by `loadConversationModelHistory` as clean,
    // role-preserving input. Do not replay the persisted Responses items here:
    // an old record can contain an assistant message without its provider
    // reasoning item, which makes the Responses API reject the whole request.
    // The historical model data remains in historyJson for diagnostics only.
    void limit;
    return [];
  }

  // The Responses API requires the provider reasoning IDs to remain intact
  // when a complete reasoning turn is persisted and replayed.
  preserveReasoningItemIdsForPersistence() {
    return true;
  }

  async addItems(items: AgentInputItem[]) {
    if (!items.length) return;
    // Persist only a compact diagnostic snapshot. It is deliberately not used
    // as future model input; the messenger transcript is the source of truth.
    const next = compactAgentSessionHistory(items);
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
