import { NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    const group = await prisma.businessGroup.findUnique({ where: { id: context.businessGroupId } });
    if (!group) return NextResponse.json({ error: "Группа бизнеса не найдена" }, { status: 404 });
    return NextResponse.json({
      businessGroup: group,
      membership: { role: context.groupRole },
      activeBranchId: context.branchId ?? "all",
    });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

