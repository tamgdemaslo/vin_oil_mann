import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { searchRosskoOemCandidates, type RosskoOemSearchInput } from "@/lib/product-oem-rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  let body: RosskoOemSearchInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  try {
    return await runWithBranchApiContext(branch.context, async () => {
      const result = await searchRosskoOemCandidates(body);
      return NextResponse.json({ ...result, rawCount: result.items.length });
    });
  } catch (error) {
    const safe = rosskoIntegrationError(error);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
