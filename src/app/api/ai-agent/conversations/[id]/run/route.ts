import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";
import { runTgmClientAgent } from "@/lib/ai-agent/runner";

const bodySchema = z.object({ message: z.string().trim().min(1).max(12_000), sourceMessageId: z.string().max(160).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAIAgentAccess();
  if ("response" in access) return access.response;
  try {
    const { id } = await params;
    const input = bodySchema.parse(await request.json());
    const wantsStream = new URL(request.url).searchParams.get("stream") === "1";
    if (!wantsStream) {
      return NextResponse.json(await runTgmClientAgent({ organizationId: access.organizationId, conversationId: id, actorId: access.actorId, message: input.message, sourceMessageId: input.sourceMessageId, triggerType: "manual" }));
    }
    const encoder = new TextEncoder();
    let streamStopped = false;
    const markStreamStopped = () => {
      streamStopped = true;
    };
    request.signal.addEventListener("abort", markStreamStopped, { once: true });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          if (streamStopped) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            streamStopped = true;
          }
        };
        const close = () => {
          request.signal.removeEventListener("abort", markStreamStopped);
          if (streamStopped) return;
          streamStopped = true;
          try {
            controller.close();
          } catch {
            // The browser may already have cancelled the response stream.
          }
        };
        void runTgmClientAgent({
          organizationId: access.organizationId,
          conversationId: id,
          actorId: access.actorId,
          message: input.message,
          sourceMessageId: input.sourceMessageId,
          triggerType: "manual",
          onText: (chunk) => send("text", { chunk }),
        })
          .then((result) => send("done", result))
          .catch((error) => send("error", { error: error instanceof Error ? error.message : String(error) }))
          .finally(close);
      },
      cancel() {
        request.signal.removeEventListener("abort", markStreamStopped);
        streamStopped = true;
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Сообщение не прошло проверку", details: error.issues }, { status: 422 });
    return aiAgentApiError(error);
  }
}
