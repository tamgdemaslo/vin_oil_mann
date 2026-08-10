import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { retryProductOemBatch } from "@/lib/product-oem-batches";
import { kickProductOemWorker } from "@/lib/product-oem-worker";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const { batchId } = await params;
    const batch = await runWithBranchApiContext(branch.context, () => retryProductOemBatch({
      branchId: branch.context.branchId!,
      batchId,
      createdById: branch.context.userId,
    }));
    kickProductOemWorker();
    return NextResponse.json({ batch }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось повторить заполнение OEM" }, { status: 400 });
  }
}
