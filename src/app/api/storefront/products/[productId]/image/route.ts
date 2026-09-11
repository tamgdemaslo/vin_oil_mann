import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  setStorefrontPublicImage,
  StorefrontPublicationError,
} from "@/lib/storefront-publication";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    const { productId } = await params;
    const body = await request.json();
    const result = await runWithBranchApiContext(access.context, () =>
      setStorefrontPublicImage(access.context, productId, body?.photoId)
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StorefrontPublicationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("storefront public image update failed", error);
    return NextResponse.json({ error: "Не удалось обновить публичное фото." }, { status: 500 });
  }
}
