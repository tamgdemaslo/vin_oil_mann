import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { previewProductOemBatch } from "@/lib/product-oem-batches";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const body = await request.json();
    const preview = await runWithBranchApiContext(branch.context, () => previewProductOemBatch({
      branchId: branch.context.branchId!,
      productIds: Array.isArray(body?.productIds) ? body.productIds : undefined,
      selection: body?.selection,
    }));
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось подготовить превью" }, { status: 400 });
  }
}
