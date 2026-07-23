import type { AgentInputItem } from "@openai/agents";
import { prisma } from "@/lib/db";

const HISTORY_LIMIT = 30;
const MAX_MESSAGE_CHARS = 1_600;
const MAX_HISTORY_CHARS = 30_000;

export type ConversationHistoryTraceItem = {
  id: string;
  externalMessageId: string | null;
  direction: string;
  authorType: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
};

export type ConversationModelHistory = {
  items: AgentInputItem[];
  trace: ConversationHistoryTraceItem[];
  containsAssistantMessage: boolean;
  lastAssistantMessage: string | null;
};

function clientItem(text: string): AgentInputItem {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  } as AgentInputItem;
}

function companyItem(text: string): AgentInputItem {
  // These are CRM transcript messages supplied by our application, not
  // provider-issued Responses output items. Deliberately omit provider IDs so
  // they never form an incomplete reasoning chain on the next request.
  return {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text }],
  } as AgentInputItem;
}

function systemItem(text: string): AgentInputItem {
  return { type: "message", role: "system", content: `Событие CRM: ${text}` } as AgentInputItem;
}

function roleFor(direction: string): ConversationHistoryTraceItem["role"] {
  if (direction === "inbound") return "user";
  if (direction === "system") return "system";
  return "assistant";
}

/**
 * The messenger database is the source of truth for the human dialogue.
 * Session history is intentionally not used here: it contains provider tool
 * items and may be compacted, whereas the exact client/company exchange must
 * remain visible to the model when it interprets a short reply.
 */
export async function loadConversationModelHistory(input: {
  organizationId: string;
  conversationId: string;
  sourceMessageId?: string | null;
  fallbackClientMessage?: string | null;
}): Promise<ConversationModelHistory> {
  const rows = await prisma.messengerMessage.findMany({
    where: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
    select: {
      id: true,
      externalMessageId: true,
      direction: true,
      authorType: true,
      text: true,
      createdAt: true,
    },
  });
  const chronological = rows.reverse();
  const completeTrace = chronological.flatMap((row): ConversationHistoryTraceItem[] => {
    const text = row.text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) return [];
    return [{
      id: row.id,
      externalMessageId: row.externalMessageId,
      direction: row.direction,
      authorType: row.authorType,
      role: roleFor(row.direction),
      text,
      createdAt: row.createdAt.toISOString(),
    }];
  });
  // Preserve the last 20–30 dialogue turns in normal conversations, but make
  // a pasted catalogue or a very long forwarded message unable to trip an
  // input-size guardrail for the entire agent run.
  let remainingChars = MAX_HISTORY_CHARS;
  let trace = completeTrace
    .slice()
    .reverse()
    .flatMap((item): ConversationHistoryTraceItem[] => {
      if (remainingChars <= 0) return [];
      const text = item.text.slice(Math.max(0, item.text.length - remainingChars));
      remainingChars -= text.length;
      return text ? [{ ...item, text }] : [];
    })
    .reverse();
  const sourceIsPresent = Boolean(input.sourceMessageId && trace.some((item) => item.id === input.sourceMessageId));
  const fallback = input.fallbackClientMessage?.trim().slice(0, MAX_MESSAGE_CHARS) || "";
  if (fallback && !sourceIsPresent && !trace.some((item) => item.role === "user" && item.text === fallback)) {
    trace.push({
      id: input.sourceMessageId || "runtime-client-message",
      externalMessageId: null,
      direction: "inbound",
      authorType: "client",
      role: "user",
      text: fallback,
      createdAt: new Date().toISOString(),
    });
  }
  const items = trace.map((item) => item.role === "user" ? clientItem(item.text) : item.role === "assistant" ? companyItem(item.text) : systemItem(item.text));
  const assistantMessages = trace.filter((item) => item.role === "assistant");
  return {
    items,
    trace,
    containsAssistantMessage: assistantMessages.length > 0,
    lastAssistantMessage: assistantMessages.at(-1)?.text ?? null,
  };
}
