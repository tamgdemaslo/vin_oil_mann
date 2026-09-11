import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  getStorefrontPublicationStatus,
  StorefrontPublicationError,
} from "@/lib/storefront-publication";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;
  try {
    const { productId } = await params;
    const result = await runWithBranchApiContext(access.context, () =>
      getStorefrontPublicationStatus(access.context, productId)
    );
    if (!result) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StorefrontPublicationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("storefront publication status failed", error);
    return NextResponse.json({ error: "Не удалось прочитать состояние публикации." }, { status: 500 });
  }
}
