import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  listRosskoIncomingOrders,
  RosskoIncomingError,
  syncRosskoIncomingOrders,
} from "@/lib/rossko-incoming";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const { orderId } = await params;
    const result = await runWithBranchApiContext(branch.context, async () => {
      await syncRosskoIncomingOrders({ context: branch.context, actor: session.user, orderIds: [orderId] });
      return listRosskoIncomingOrders({ context: branch.context, actor: session.user, sync: false });
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RosskoIncomingError) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    const safe = rosskoIntegrationError(error);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
