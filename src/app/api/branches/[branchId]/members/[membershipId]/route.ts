import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, hasBranchPermission, requireBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

const BRANCH_ROLES = new Set(["branch_owner", "administrator", "master", "mechanic", "accountant", "viewer"]);

async function access(branchId: string, membershipId: string) {
  const context = await requireBranchContext({ allowAll: true, requireActive: false });
  if (!hasBranchPermission(context, "branches.manage_members", branchId)) return { context, membership: null, status: 403, error: "Недостаточно прав" };
  const membership = await prisma.branchMembership.findFirst({
    where: { id: membershipId, branchId, branch: { businessGroupId: context.businessGroupId } },
  });
  if (!membership) return { context, membership: null, status: 404, error: "Доступ сотрудника не найден" };
  return { context, membership, status: 200, error: null };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ branchId: string; membershipId: string }> }) {
  try {
    const { branchId, membershipId } = await params;
    const gate = await access(branchId, membershipId);
    if (!gate.membership) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const body = (await request.json()) as { roleId?: unknown; status?: unknown; permissionsJson?: unknown };
    const roleId = typeof body.roleId === "string" ? body.roleId : gate.membership.roleId;
    const status = body.status === "disabled" ? "disabled" : "active";
    if (!BRANCH_ROLES.has(roleId)) return NextResponse.json({ error: "Недопустимая роль филиала" }, { status: 400 });
    const membership = await prisma.branchMembership.update({
      where: { id: gate.membership.id },
      data: { roleId, status, permissionsJson: body.permissionsJson === undefined ? undefined : body.permissionsJson as never },
      include: { user: { select: { id: true, login: true, name: true, status: true } } },
    });
    return NextResponse.json({ membership });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ branchId: string; membershipId: string }> }) {
  try {
    const { branchId, membershipId } = await params;
    const gate = await access(branchId, membershipId);
    if (!gate.membership) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await prisma.branchMembership.update({ where: { id: gate.membership.id }, data: { status: "disabled", isDefaultBranch: false } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}
