import { NextRequest, NextResponse } from "next/server";
import { getPublicUsers } from "@/lib/auth";
import { branchErrorResponse, hasBranchPermission, requireBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

const BRANCH_ROLES = new Set(["branch_owner", "administrator", "master", "mechanic", "accountant", "viewer"]);

async function requireManagedBranch(branchId: string) {
  const context = await requireBranchContext({ allowAll: true, requireActive: false });
  if (!hasBranchPermission(context, "branches.manage_members", branchId)) return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  const branch = await prisma.branch.findFirst({ where: { id: branchId, businessGroupId: context.businessGroupId } });
  if (!branch) return { response: NextResponse.json({ error: "Филиал не найден" }, { status: 404 }) };
  return { context, branch };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const { branchId } = await params;
    const access = await requireManagedBranch(branchId);
    if ("response" in access) return access.response;
    const memberships = await prisma.branchMembership.findMany({
      where: { branchId },
      include: { user: { select: { id: true, login: true, name: true, status: true } } },
      orderBy: [{ status: "asc" }, { joinedAt: "asc" }],
    });
    return NextResponse.json({ memberships });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const { branchId } = await params;
    const access = await requireManagedBranch(branchId);
    if ("response" in access) return access.response;
    const body = (await request.json()) as { login?: unknown; roleId?: unknown; permissionsJson?: unknown };
    const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
    const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
    if (!login) return NextResponse.json({ error: "Укажите логин сотрудника" }, { status: 400 });
    if (!BRANCH_ROLES.has(roleId)) return NextResponse.json({ error: "Недопустимая роль филиала" }, { status: 400 });
    const configured = (await getPublicUsers()).find((user) => user.login.toLowerCase() === login);
    if (!configured) return NextResponse.json({ error: "Сначала добавьте пользователя в AUTH_USERS" }, { status: 404 });
    const user = await prisma.user.upsert({
      where: { login },
      update: { name: configured.name, authRole: configured.role, status: "active" },
      create: { login, name: configured.name, authRole: configured.role },
    });
    const membership = await prisma.branchMembership.upsert({
      where: { branchId_userId: { branchId, userId: user.id } },
      update: { roleId, status: "active", permissionsJson: body.permissionsJson as never },
      create: { branchId, userId: user.id, roleId, permissionsJson: body.permissionsJson as never },
      include: { user: { select: { id: true, login: true, name: true, status: true } } },
    });
    await prisma.branchAuditLog.create({
      data: { businessGroupId: access.context.businessGroupId, branchId, userId: access.context.userId, action: "branch_member_assigned", entityType: "branch_membership", entityId: membership.id, metadata: { login, roleId } },
    });
    return NextResponse.json({ membership }, { status: 201 });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}
