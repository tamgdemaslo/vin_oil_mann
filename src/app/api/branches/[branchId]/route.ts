import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { archiveBranch, updateBranch, type BranchInput } from "@/lib/branches";
import { prisma } from "@/lib/db";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    const { branchId } = await params;
    if (!context.branches.some((branch) => branch.id === branchId)) {
      return NextResponse.json({ error: "Филиал недоступен" }, { status: 403 });
    }
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, businessGroupId: context.businessGroupId },
      include: { communication: true, legalEntities: true, telegramIntegration: { select: { status: true, phoneNumberMasked: true, telegramUsername: true, connectedAt: true, lastSyncAt: true, errorCode: true } } },
    });
    if (!branch) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 });
    return NextResponse.json({ branch });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    const { branchId } = await params;
    const body = (await request.json()) as BranchInput;
    if (body.status === "archived") {
      const archived = await archiveBranch(context, branchId);
      if (!archived.ok) return NextResponse.json({ error: archived.error }, { status: archived.status });
      return NextResponse.json({ branch: archived.branch });
    }
    const result = await updateBranch(context, branchId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ branch: result.branch });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}
