import { NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { getProductCopyCapabilities } from "@/lib/product-copy-between-branches";

export async function GET() {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const capabilities = await getProductCopyCapabilities(branch.context);
  return NextResponse.json({
    canCopy: capabilities.canCopy,
    sourceBranch: capabilities.sourceBranch,
    targetBranches: capabilities.targetBranches,
  });
}
