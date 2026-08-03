import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { archiveBranch } from "@/lib/branches";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    const { branchId } = await params;
    const result = await archiveBranch(context, branchId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ branch: result.branch });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

