import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listConversations, listMessages } from "@/lib/messenger/messenger-gateway";
import type { Conversation, Message, MessengerRealtimeEvent } from "@/lib/messenger/messenger-types";

export const dynamic = "force-dynamic";

const STREAM_POLL_INTERVAL_MS = 15_000;
const encoder = new TextEncoder();

function unreadTotal(conversations: Conversation[]) {
  return conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
}

function conversationSignature(conversation: Conversation) {
  return [
    conversation.lastMessageText,
    conversation.lastMessageAt,
    conversation.unreadCount,
    conversation.status,
    conversation.isImportant,
    conversation.isPinned,
    conversation.assignedTo ?? "",
    conversation.clientId ?? "",
  ].join("|");
}

function messageSignature(message: Message) {
  return [message.text, message.createdAt, message.status, message.channelMessageId ?? ""].join("|");
}

function encodeSse(event: MessengerRealtimeEvent) {
  return encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function encodeComment(text: string) {
  return encoder.encode(`: ${text}\n\n`);
}

function eventId(type: MessengerRealtimeEvent["type"], key = "all") {
  return `${type}:${key}:${Date.now()}`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId") || undefined;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let initialized = false;
      let previousUnreadTotal = 0;
      let previousConversations = new Map<string, string>();
      let previousMessages = new Map<string, string>();

      const enqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      const emit = (event: MessengerRealtimeEvent) => enqueue(encodeSse(event));

      const emitSnapshot = async () => {
        if (closed) return;
        const createdAt = new Date().toISOString();
        const conversations = await listConversations({ limit: 100 });
        const nextConversationSignatures = new Map<string, string>();
        const nextUnreadTotal = unreadTotal(conversations);

        if (initialized && nextUnreadTotal !== previousUnreadTotal) {
          emit({
            id: eventId("unread.updated"),
            type: "unread.updated",
            createdAt,
            unreadTotal: nextUnreadTotal,
            payload: { unreadTotal: nextUnreadTotal },
          });
        }

        for (const conversation of conversations) {
          const signature = conversationSignature(conversation);
          nextConversationSignatures.set(conversation.id, signature);
          const previousSignature = previousConversations.get(conversation.id);
          if (!initialized) continue;
          if (!previousSignature) {
            emit({
              id: eventId("conversation.created", conversation.id),
              type: "conversation.created",
              createdAt,
              conversationId: conversation.id,
              payload: conversation,
            });
          } else if (previousSignature !== signature) {
            emit({
              id: eventId("conversation.updated", conversation.id),
              type: "conversation.updated",
              createdAt,
              conversationId: conversation.id,
              payload: conversation,
            });
          }
        }

        if (conversationId) {
          const messages = await listMessages(conversationId);
          const nextMessageSignatures = new Map<string, string>();
          for (const message of messages) {
            const signature = messageSignature(message);
            nextMessageSignatures.set(message.id, signature);
            const previousSignature = previousMessages.get(message.id);
            if (!initialized) continue;
            if (!previousSignature) {
              emit({
                id: eventId("message.created", message.id),
                type: "message.created",
                createdAt,
                conversationId,
                messageId: message.id,
                payload: message,
              });
            } else if (previousSignature !== signature) {
              emit({
                id: eventId("message.status_updated", message.id),
                type: "message.status_updated",
                createdAt,
                conversationId,
                messageId: message.id,
                payload: message,
              });
            }
          }
          previousMessages = nextMessageSignatures;
        }

        previousConversations = nextConversationSignatures;
        previousUnreadTotal = nextUnreadTotal;
        initialized = true;
        enqueue(encodeComment(`messenger heartbeat ${createdAt}`));
      };

      const timer = setInterval(() => {
        void emitSnapshot().catch((error) => {
          enqueue(encodeComment(`messenger error ${error instanceof Error ? error.message : "unknown"}`));
        });
      }, STREAM_POLL_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });

      void emitSnapshot().catch((error) => {
        enqueue(encodeComment(`messenger error ${error instanceof Error ? error.message : "unknown"}`));
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
