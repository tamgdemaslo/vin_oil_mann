import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { rosskoIntegrationError } from "@/lib/rossko-integration";
import {
  createRosskoReceiptDraft,
  RosskoReceiptError,
  type RosskoReceiptDraftDecision,
} from "@/lib/rossko-receipt";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  try {
    const body = await request.json();
    const { orderId } = await params;
    const result = await runWithBranchApiContext(branch.context, () => createRosskoReceiptDraft({
      context: branch.context,
      actor: session.user,
      orderId,
      storeId: typeof body?.storeId === "string" ? body.storeId : undefined,
      lines: Array.isArray(body?.lines) ? body.lines as RosskoReceiptDraftDecision[] : [],
    }));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RosskoReceiptError) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    const safe = rosskoIntegrationError(error);
    if (safe.code && safe.code !== "ROSSKO_UNKNOWN") {
      return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
    }
    console.error("ROSSKO receipt draft failed", error);
    return NextResponse.json({ error: "Не удалось создать черновик приёмки ROSSKO" }, { status: 500 });
  }
}
