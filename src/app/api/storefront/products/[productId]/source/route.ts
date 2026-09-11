import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  changeStorefrontProductContentSource,
  StorefrontPublicationError,
} from "@/lib/storefront-publication";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    const { productId } = await params;
    const result = await runWithBranchApiContext(access.context, () =>
      changeStorefrontProductContentSource(access.context, productId)
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StorefrontPublicationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("storefront content source change failed", error);
    return NextResponse.json({ error: "Не удалось изменить источник общей карточки." }, { status: 500 });
  }
}
