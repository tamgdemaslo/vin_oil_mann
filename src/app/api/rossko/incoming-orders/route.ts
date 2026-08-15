import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  listRosskoIncomingOrders,
  RosskoIncomingError,
  trackRosskoOrderSeeds,
  type RosskoTrackedOrderSeedInput,
} from "@/lib/rossko-incoming";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";
export const maxDuration = 120;

function errorResponse(error: unknown) {
  if (error instanceof RosskoIncomingError) {
    return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
  }
  const safe = rosskoIntegrationError(error);
  return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const sync = !["0", "false"].includes(request.nextUrl.searchParams.get("sync") ?? "1");
    const result = await runWithBranchApiContext(branch.context, () => listRosskoIncomingOrders({
      context: branch.context,
      actor: session.user,
      sync,
    }));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const body = await request.json().catch(() => ({})) as {
      orders?: RosskoTrackedOrderSeedInput[];
      orderIds?: Array<string | number>;
      sync?: boolean;
    };
    const orders = [
      ...(Array.isArray(body.orders) ? body.orders : []),
      ...(Array.isArray(body.orderIds) ? body.orderIds.map((externalOrderId) => ({ externalOrderId: String(externalOrderId) })) : []),
    ];
    const result = await runWithBranchApiContext(branch.context, async () => {
      await trackRosskoOrderSeeds({ context: branch.context, actor: session.user, orders });
      return listRosskoIncomingOrders({ context: branch.context, actor: session.user, sync: body.sync !== false });
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
