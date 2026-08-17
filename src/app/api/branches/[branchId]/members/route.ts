import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getPublicUsers, hashAuthPassword, invalidateAuthPasswordCache } from "@/lib/auth";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

const BRANCH_ROLES = new Set(["branch_owner", "administrator", "master", "mechanic", "accountant", "viewer"]);
const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PIN_PATTERN = /^\d{4}$/;

function authRoleForBranch(roleId: string) {
  if (roleId === "branch_owner") return "owner";
  if (roleId === "administrator") return "admin";
  return "master";
}

async function requireManagedBranch(branchId: string) {
  const context = await requireBranchContext({ allowAll: true, requireActive: false });
  if (!context.canManageBranches) return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
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
    const body = (await request.json()) as {
      createUser?: unknown;
      login?: unknown;
      name?: unknown;
      password?: unknown;
      passwordConfirmation?: unknown;
      roleId?: unknown;
      permissionsJson?: unknown;
    };
    const createUser = body.createUser === true;
    const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
    const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
    if (!login) return NextResponse.json({ error: "Укажите логин сотрудника" }, { status: 400 });
    if (!BRANCH_ROLES.has(roleId)) return NextResponse.json({ error: "Недопустимая роль филиала" }, { status: 400 });

    if (createUser) {
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      const password = typeof body.password === "string" ? body.password : "";
      const passwordConfirmation = typeof body.passwordConfirmation === "string" ? body.passwordConfirmation : "";
      if (name.length < 2 || name.length > 100) {
        return NextResponse.json({ error: "Укажите имя сотрудника длиной от 2 до 100 символов" }, { status: 400 });
      }
      if (!LOGIN_PATTERN.test(login)) {
        return NextResponse.json({ error: "Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание" }, { status: 400 });
      }
      if (!PIN_PATTERN.test(password)) {
        return NextResponse.json({ error: "Временный пароль должен состоять ровно из 4 цифр" }, { status: 400 });
      }
      if (password !== passwordConfirmation) {
        return NextResponse.json({ error: "Введённые пароли не совпадают" }, { status: 400 });
      }
      const [configured, databaseUser] = await Promise.all([
        getPublicUsers(),
        prisma.user.findUnique({ where: { login }, select: { id: true } }),
      ]);
      if (databaseUser || configured.some((user) => user.login.toLowerCase() === login)) {
        return NextResponse.json({ error: "Такой логин уже существует. Выберите пользователя из списка ниже." }, { status: 409 });
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { login, name, authRole: authRoleForBranch(roleId), status: "active" },
          });
          await tx.authPassword.create({ data: { login, passwordHash: hashAuthPassword(password) } });
          const membership = await tx.branchMembership.create({
            data: { branchId, userId: user.id, roleId, status: "active", isDefaultBranch: true, permissionsJson: body.permissionsJson as never },
            include: { user: { select: { id: true, login: true, name: true, status: true } } },
          });
          await tx.branchAuditLog.create({
            data: {
              businessGroupId: access.context.businessGroupId,
              branchId,
              userId: access.context.userId,
              action: "branch_member_created",
              entityType: "branch_membership",
              entityId: membership.id,
              metadata: { login, roleId },
            },
          });
          return membership;
        });
        invalidateAuthPasswordCache();
        return NextResponse.json({ membership: result, createdUser: true }, { status: 201 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return NextResponse.json({ error: "Такой логин уже существует. Выберите другой логин." }, { status: 409 });
        }
        throw error;
      }
    }

    const configured = (await getPublicUsers()).find((user) => user.login.toLowerCase() === login);
    if (!configured) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
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
