import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { inventoryPreviewScope } from "@/lib/inventory-catalog-preview";
import { getInventoryCatalogPreview } from "@/lib/catalog-search";

export async function GET(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const { branchId } = branch.context;
  if (!branchId) return NextResponse.json({ error: "Выберите рабочий филиал" }, { status: 403 });

  return runWithBranchApiContext(branch.context, async () => {
    const preview = await getInventoryCatalogPreview(branchId, request.nextUrl.searchParams);
    return NextResponse.json({ ...preview, scope: inventoryPreviewScope(branch.context) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
