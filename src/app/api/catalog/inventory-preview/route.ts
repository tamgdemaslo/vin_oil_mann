import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { inventoryPreviewScope, loadInventoryCatalogPreview } from "@/lib/inventory-catalog-preview";

export async function GET() {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const { branchId } = branch.context;
  if (!branchId) return NextResponse.json({ error: "Выберите рабочий филиал" }, { status: 403 });

  return runWithBranchApiContext(branch.context, async () => {
    const preview = await loadInventoryCatalogPreview(branchId);
    return NextResponse.json({ ...preview, scope: inventoryPreviewScope(branch.context) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
