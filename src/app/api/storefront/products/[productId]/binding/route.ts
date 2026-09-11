import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  bindStorefrontProductCandidate,
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
    const [{ productId }, body] = await Promise.all([params, request.json()]);
    const result = await runWithBranchApiContext(access.context, () =>
      bindStorefrontProductCandidate(access.context, productId, body?.storefrontProductId)
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StorefrontPublicationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("storefront manual binding failed", error);
    return NextResponse.json({ error: "Не удалось связать товар с общей карточкой." }, { status: 500 });
  }
}
