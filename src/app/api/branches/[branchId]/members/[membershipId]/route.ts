import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { readEmployeePaySettings } from "@/lib/employee-pay-settings";
import { toServiceDateInput } from "@/lib/date-time";
import { invalidatePayrollCache } from "@/lib/payroll";

const BRANCH_ROLES = new Set(["branch_owner", "administrator", "master", "mechanic", "accountant", "viewer"]);

async function access(branchId: string, membershipId: string) {
  const context = await requireBranchContext({ allowAll: true, requireActive: false });
  if (!context.canManageBranches) return { context, membership: null, status: 403, error: "Недостаточно прав" };
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
    const body = (await request.json()) as { roleId?: unknown; status?: unknown; permissionsJson?: unknown; employmentEnd?: unknown };
    const roleId = typeof body.roleId === "string" ? body.roleId : gate.membership.roleId;
    if (body.status !== undefined && body.status !== "active" && body.status !== "disabled") return NextResponse.json({ error: "Недопустимый статус доступа" }, { status: 400 });
    const settings = readEmployeePaySettings(gate.membership.paySettingsJson);
    if (body.employmentEnd !== undefined) {
      if (gate.context.user.role !== "owner") return NextResponse.json({ error: "Увольнение доступно только владельцу" }, { status: 403 });
      const date = body.employmentEnd;
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > toServiceDateInput(new Date()) || (gate.membership.employmentStart && date < gate.membership.employmentStart.toISOString().slice(0, 10))) {
        return NextResponse.json({ error: "Укажите корректный последний рабочий день, не позднее сегодня и не раньше приёма" }, { status: 400 });
      }
      const user = await prisma.user.findUnique({ where: { id: gate.membership.userId }, select: { login: true, authRole: true } });
      if (gate.membership.roleId === "branch_owner" || user?.authRole === "owner" || user?.login === gate.context.user.login) return NextResponse.json({ error: "Нельзя уволить владельца филиала или самого себя" }, { status: 400 });
      if (settings.employmentEnd) return NextResponse.json({ error: "Сотрудник уже уволен" }, { status: 409 });
      const next = { ...settings, employmentEnd: date };
      const count = await prisma.$transaction(async (tx) => {
        const result = await tx.branchMembership.updateMany({ where: { id: membershipId, branchId, updatedAt: gate.membership!.updatedAt }, data: { status: "disabled", isDefaultBranch: false, paySettingsJson: next } });
        if (result.count) await tx.changeLog.create({ data: { branchId, entityType: "employee_employment", entityId: membershipId, action: "update", oldValue: { status: gate.membership!.status, paySettings: settings } as never, newValue: { status: "disabled", paySettings: next } as never, performedByLogin: gate.context.user.login } });
        return result.count;
      });
      if (!count) return NextResponse.json({ error: "Настройки изменились. Обновите страницу." }, { status: 409 });
      invalidatePayrollCache();
      return NextResponse.json({ ok: true, employmentEnd: date });
    }
    const status = body.status === undefined ? gate.membership.status : body.status === "disabled" ? "disabled" : "active";
    if (settings.employmentEnd && (status === "active" || roleId !== gate.membership.roleId)) return NextResponse.json({ error: "Сотрудник уволен; его роль и доступ сохранены в архиве" }, { status: 400 });
    if (!BRANCH_ROLES.has(roleId)) return NextResponse.json({ error: "Недопустимая роль филиала" }, { status: 400 });
    const updated = await prisma.branchMembership.updateMany({
      where: { id: gate.membership.id, branchId, updatedAt: gate.membership.updatedAt },
      data: { roleId, status, permissionsJson: body.permissionsJson === undefined ? undefined : body.permissionsJson as never },
    });
    if (!updated.count) return NextResponse.json({ error: "Настройки изменились. Обновите страницу." }, { status: 409 });
    const membership = await prisma.branchMembership.findFirst({
      where: { id: gate.membership.id, branchId },
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

