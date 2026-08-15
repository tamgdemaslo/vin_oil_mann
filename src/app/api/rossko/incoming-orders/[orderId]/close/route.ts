import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  closeRosskoIncomingLines,
  ROSSKO_MANUAL_CLOSE_REASONS,
  RosskoIncomingError,
  type RosskoManualCloseReason,
} from "@/lib/rossko-incoming";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const body = await request.json() as {
      reason?: string;
      comment?: string | null;
      idempotencyKey?: string;
      lines?: Array<{ sourceLineKey?: string; quantity?: number }>;
    };
    const reason = String(body.reason ?? "") as RosskoManualCloseReason;
    if (!ROSSKO_MANUAL_CLOSE_REASONS.includes(reason)) {
      throw new RosskoIncomingError("Выберите причину закрытия", 400, "CLOSE_REASON_REQUIRED");
    }
    const { orderId } = await params;
    const result = await runWithBranchApiContext(branch.context, () => closeRosskoIncomingLines({
      context: branch.context,
      actor: session.user,
      orderId,
      reason,
      comment: body.comment,
      idempotencyKey: String(body.idempotencyKey ?? ""),
      lines: (Array.isArray(body.lines) ? body.lines : []).map((line) => ({
        sourceLineKey: String(line.sourceLineKey ?? ""),
        quantity: Number(line.quantity ?? 0),
      })),
    }));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RosskoIncomingError) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    const safe = rosskoIntegrationError(error);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
