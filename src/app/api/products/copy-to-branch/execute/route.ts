import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { executeProductCopy, ProductCopyError } from "@/lib/product-copy-between-branches";

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const body = await request.json();
    const result = await executeProductCopy(branch.context, {
      targetBranchId: body?.targetBranchId,
      productIds: body?.productIds,
      options: body?.options,
      idempotencyKey: body?.idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductCopyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("product copy execute failed", error);
    return NextResponse.json({ error: "Не удалось скопировать карточки товаров" }, { status: 500 });
  }
}
