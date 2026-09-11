import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  applyStorefrontPublication,
  StorefrontPublicationError,
} from "@/lib/storefront-publication";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const result = await runWithBranchApiContext(access.context, () =>
      applyStorefrontPublication(access.context, body?.batchId)
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StorefrontPublicationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("storefront publication apply failed", error);
    return NextResponse.json({ error: "Не удалось изменить публикацию." }, { status: 500 });
  }
}
