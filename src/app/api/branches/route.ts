import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { createBranch, type BranchInput } from "@/lib/branches";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    if (!context.canViewBranches) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    const allowedIds = context.branches.map((branch) => branch.id);
    const branches = await prisma.branch.findMany({
      where: { id: { in: allowedIds }, businessGroupId: context.businessGroupId },
      include: {
        communication: true,
        legalEntities: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        telegramIntegration: { select: { status: true, connectedAt: true, lastSyncAt: true, errorCode: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({
      branches,
      activeBranchId: context.branchId ?? "all",
      mode: context.mode,
      canManageBranches: context.canManageBranches,
      permissions: context.permissions,
      canViewBranches: context.canViewBranches,
      canViewAllBranches: context.canViewAllBranches,
      canCreateBranches: context.canCreateBranches,
      canUpdateBranches: context.canUpdateBranches,
      canArchiveBranches: context.canArchiveBranches,
      canManageBranchMembers: context.canManageBranchMembers,
      canManageIntegrations: context.canManageIntegrations,
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
