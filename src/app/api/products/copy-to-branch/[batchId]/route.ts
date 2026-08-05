import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { getProductCopyBatch, ProductCopyError } from "@/lib/product-copy-between-branches";

export async function GET(_request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const { batchId } = await context.params;
    return NextResponse.json(await getProductCopyBatch(branch.context, batchId));
  } catch (error) {
    if (error instanceof ProductCopyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("product copy batch read failed", error);
    return NextResponse.json({ error: "Не удалось прочитать пакет копирования" }, { status: 500 });
  }
}
