import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getProductOemBatch } from "@/lib/product-oem-batches";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  const { batchId } = await params;
  const batch = await runWithBranchApiContext(branch.context, () => getProductOemBatch(branch.context.branchId!, batchId));
  if (!batch) return NextResponse.json({ error: "Запуск не найден" }, { status: 404 });
  return NextResponse.json({ batch });
}
