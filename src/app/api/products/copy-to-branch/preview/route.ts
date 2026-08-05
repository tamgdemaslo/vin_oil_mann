import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { ProductCopyError, previewProductCopy } from "@/lib/product-copy-between-branches";

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const body = await request.json();
    const preview = await previewProductCopy(branch.context, {
      targetBranchId: body?.targetBranchId,
      productIds: body?.productIds,
      options: body?.options,
    });
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof ProductCopyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("product copy preview failed", error);
    return NextResponse.json({ error: "Не удалось подготовить предпросмотр копирования" }, { status: 500 });
  }
}
