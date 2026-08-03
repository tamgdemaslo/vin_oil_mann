import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { createBranch, type BranchInput } from "@/lib/branches";

export async function GET() {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    return NextResponse.json({
      branches: context.branches,
      activeBranchId: context.branchId ?? "all",
      mode: context.mode,
      canManageBranches: context.canManageBranches,
      canViewAllBranches: Boolean(context.groupRole),
    });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    const body = (await request.json()) as BranchInput;
    const result = await createBranch(context, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ branch: result.branch }, { status: 201 });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

