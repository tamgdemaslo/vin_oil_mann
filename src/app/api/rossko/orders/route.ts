import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { rosskoConfig, rosskoOrders } from "@/lib/rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const raw = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
  const ids = raw.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length) {
    return NextResponse.json({ error: "ids должен содержать номера заказов через запятую" }, { status: 400 });
  }

  try {
    const data = await runWithBranchApiContext(branch.context, async () => rosskoOrders(await rosskoConfig(), ids));
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const safe = rosskoIntegrationError(e);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
