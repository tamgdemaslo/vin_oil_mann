import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listSharedKits as listKits, saveSharedKit as saveKit } from "@/lib/shared-product-kits";
import { kitErrorResponse } from "@/lib/product-kit-api-error";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    try {
      const sp = request.nextUrl.searchParams;
      return NextResponse.json(await listKits(access.context.branchId!, {
        storeId: sp.get("storeId"), q: sp.get("q")?.trim(),
        page: Math.max(0, Math.min(100_000, parseInt(sp.get("page") ?? "0", 10) || 0)), archived: sp.get("archived") === "1",
      }));
    } catch (error) { return kitErrorResponse(error); }
  });
}

export async function POST(request: NextRequest) {
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    try { return NextResponse.json(await saveKit(access.context.branchId!, await request.json()), { status: 201 }); }
    catch (error) { return kitErrorResponse(error); }
  });
}
