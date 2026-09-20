import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { advanceProductOemBatch } from "@/lib/product-oem-batches";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  const { batchId } = await params;
  try {
    const batch = await runWithBranchApiContext(
      branch.context,
      () => advanceProductOemBatch(branch.context.branchId!, batchId),
    );
    if (!batch) return NextResponse.json({ error: "Запуск не найден" }, { status: 404 });
    return NextResponse.json({ batch });
  } catch (error) {
    console.error("product OEM batch processing failed", { batchId, error });
    return NextResponse.json({ error: "Не удалось продолжить заполнение OEM" }, { status: 500 });
  }
}
