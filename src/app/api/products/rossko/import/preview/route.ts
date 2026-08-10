import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { rosskoIntegrationError } from "@/lib/rossko-integration";
import { previewRosskoProductImport, RosskoProductImportError } from "@/lib/rossko-product-import";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  try {
    const body = await request.json();
    const result = await runWithBranchApiContext(branch.context, () => previewRosskoProductImport({
      branchId: branch.context.branchId!,
      orderId: String(body?.orderId ?? ""),
    }));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RosskoProductImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const safe = rosskoIntegrationError(error);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
