import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  PieceworkMode,
  PieceworkRole,
  PieceworkTargetType,
  isAllowedPieceworkRule,
  listPieceworkRules,
  listPieceworkTargets,
} from "@/lib/piecework-rules";
import { logChange } from "@/lib/change-log";
import { requireBranchApi } from "@/lib/branch-api";
import { canonicalizeLogin } from "@/lib/auth";
import { listPayrollEmployees } from "@/lib/payroll-employees";
import { readEmployeePaySettings, type EmployeeRule } from "@/lib/employee-pay-settings";
import { invalidatePayrollCache } from "@/lib/payroll";

function isRole(value: string): value is PieceworkRole {
  return value === "master" || value === "admin";
}

function isTargetType(value: string): value is PieceworkTargetType {
  return value === "service" || value === "product_group";
}

function isMode(value: string): value is PieceworkMode {
  return value === "fixed" || value === "percent";
}

async function requireOwner() {
  const session = await getSession();
  if (!session) return { ok: false as const, response: NextResponse.json({ error: "Необходимо войти" }, { status: 401 }) };
  if (session.user.role !== "owner") {
    return { ok: false as const, response: NextResponse.json({ error: "Только владелец может менять правила" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

async function resolveTarget(branchId: string, targetType: PieceworkTargetType, targetId: string) {
  if (targetType === "service") {
    return prisma.localProduct.findFirst({
      where: { id: targetId, branchId, entityType: "service", archived: false },
      select: { id: true, name: true },
    });
  }
  return prisma.localCatalogGroup.findFirst({
    where: { id: targetId, branchId, kind: "product", archived: false },
    select: { id: true, name: true },
  });
}

export async function GET() {
  const owner = await requireOwner();
  if (!owner.ok) return owner.response;
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;
  const branchId = branchAccess.context.branchId!;
  const [rules, targets] = await Promise.all([listPieceworkRules(branchId), listPieceworkTargets(branchId)]);
  const employees = await listPayrollEmployees(branchId);
  const individualRules = employees.flatMap((employee) => (employee.settings.pieceworkRules ?? []).map((rule) => ({
    ...rule, role: employee.role === "admin" ? "admin" : "master", employeeLogin: employee.login, isConfigured: true, isDefault: false,
  })));
  return NextResponse.json({ rules: [...rules, ...individualRules], targets, employeeModes: Object.fromEntries(employees.map((employee) => [employee.login, Boolean(employee.settings.individualPiecework)])) });
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner.ok) return owner.response;
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const branchId = branchAccess.context.branchId!;
  const body = await request.json();
  const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode.trim() : "";
  const fixedRaw = body.fixedCents == null ? null : Number(body.fixedCents);
  const percentRaw = body.percentBasisPoints == null ? null : Number(body.percentBasisPoints);

  const employeeLogin = typeof body.employeeLogin === "string" ? canonicalizeLogin(body.employeeLogin) : "";
  const allTarget = employeeLogin && (targetType === "all_services" || targetType === "all_products");
  if ((!isTargetType(targetType) && !allTarget) || !targetId || !isRole(role) || !isMode(mode)) {
    return NextResponse.json({ error: "Некорректные данные правила" }, { status: 400 });
  }
  if (!allTarget && !isAllowedPieceworkRule(targetType as PieceworkTargetType, role)) {
    return NextResponse.json(
      { error: "Выберите услугу или группу товаров" },
      { status: 400 }
    );
  }

  const fixedCents = fixedRaw == null ? null : Math.round(fixedRaw);
  const percentBasisPoints = percentRaw == null ? null : Math.round(percentRaw);
  if (!Number.isFinite(fixedCents ?? 0) || !Number.isFinite(percentBasisPoints ?? 0)) {
    return NextResponse.json({ error: "Значение правила должно быть числом" }, { status: 400 });
  }
  if (mode === "fixed" && (fixedCents == null || fixedCents < 0)) {
    return NextResponse.json({ error: "Для фиксированной выплаты укажите сумму не меньше 0" }, { status: 400 });
  }
  if (mode === "percent" && (percentBasisPoints == null || percentBasisPoints < 0 || percentBasisPoints > 10_000)) {
    return NextResponse.json({ error: "Для процента укажите значение от 0 до 100" }, { status: 400 });
  }

  const target = allTarget
    ? { id: "*", name: targetType === "all_services" ? "Все услуги" : "Все товары" }
    : await resolveTarget(branchId, targetType as PieceworkTargetType, targetId);
  if (!target) {
    return NextResponse.json(
      { error: targetType === "service" ? "Услуга не найдена в активном филиале" : "Группа товаров не найдена в активном филиале" },
      { status: 400 }
    );
  }

  if (employeeLogin) {
    const member = await prisma.branchMembership.findFirst({ where: { branchId, user: { login: { equals: employeeLogin, mode: "insensitive" } } } });
    if (!member) return NextResponse.json({ error: "Сотрудник не найден в филиале" }, { status: 404 });
    const settings = readEmployeePaySettings(member.paySettingsJson);
    if (settings.employmentEnd) return NextResponse.json({ error: "Сотрудник уволен. Его правила сохранены в истории." }, { status: 400 });
    const rule: EmployeeRule = { targetType: targetType as EmployeeRule["targetType"], targetId: target.id, targetName: target.name, mode, fixedCents: mode === "fixed" ? fixedCents : null, percentBasisPoints: mode === "percent" ? percentBasisPoints : null };
    const rules = (settings.pieceworkRules ?? []).filter((item) => item.targetType !== rule.targetType || item.targetId !== rule.targetId);
    rules.push(rule);
    const next = { ...settings, individualPiecework: true, pieceworkRules: rules };
    const saved = await prisma.$transaction(async (tx) => {
      const result = await tx.branchMembership.updateMany({ where: { id: member.id, branchId, updatedAt: member.updatedAt }, data: { paySettingsJson: next } });
      if (result.count) await tx.changeLog.create({ data: { branchId, entityType: "employee_piecework", entityId: member.id, action: "update", oldValue: settings as never, newValue: next as never, performedByLogin: owner.session.user.login } });
      return result.count;
    });
    if (!saved) return NextResponse.json({ error: "Настройки изменились. Обновите страницу и повторите." }, { status: 409 });
    invalidatePayrollCache();
    return NextResponse.json(rule);
  }

  const existing = await prisma.pieceworkRule.findUnique({
    where: { branchId_targetType_targetId_role: { branchId, targetType, targetId, role } },
  });
  const data = {
    targetName: target.name,
    mode,
    fixedCents: mode === "fixed" ? fixedCents : null,
    percentBasisPoints: mode === "percent" ? percentBasisPoints : null,
  };
  const saved = existing
    ? await prisma.pieceworkRule.update({ where: { id: existing.id }, data })
    : await prisma.pieceworkRule.create({ data: { branchId, targetType, targetId, role, ...data } });

  await logChange({
    entityType: "piecework_rule",
    entityId: saved.id,
    action: existing ? "update" : "create",
    oldValue: existing
      ? {
          targetType: existing.targetType,
          targetId: existing.targetId,
          targetName: existing.targetName,
          role: existing.role,
          mode: existing.mode,
          fixedCents: existing.fixedCents,
          percentBasisPoints: existing.percentBasisPoints,
        }
      : null,
    newValue: { targetType, targetId, role, ...data },
    performedByLogin: owner.session.user.login,
  });

  invalidatePayrollCache();
  return NextResponse.json(saved);
}

export async function DELETE(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner.ok) return owner.response;
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const branchId = branchAccess.context.branchId!;
  const targetType = request.nextUrl.searchParams.get("targetType") ?? "";
  const targetId = request.nextUrl.searchParams.get("targetId")?.trim() ?? "";
  const role = request.nextUrl.searchParams.get("role") ?? "";
  const employeeLogin = canonicalizeLogin(request.nextUrl.searchParams.get("employeeLogin") ?? "");
  const allTarget = employeeLogin && (targetType === "all_services" || targetType === "all_products");
  if ((!isTargetType(targetType) && !allTarget) || !targetId || !isRole(role)) {
    return NextResponse.json({ error: "Некорректные параметры удаления" }, { status: 400 });
  }

  if (employeeLogin) {
    const member = await prisma.branchMembership.findFirst({ where: { branchId, user: { login: { equals: employeeLogin, mode: "insensitive" } } } });
    if (!member) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
    const settings = readEmployeePaySettings(member.paySettingsJson);
    if (settings.employmentEnd) return NextResponse.json({ error: "Правила уволенного сотрудника доступны только для просмотра" }, { status: 400 });
    const reset = request.nextUrl.searchParams.get("reset") === "true";
    const next = { ...settings, individualPiecework: !reset, pieceworkRules: reset ? [] : (settings.pieceworkRules ?? []).filter((rule) => rule.targetType !== targetType || rule.targetId !== targetId) };
    const saved = await prisma.$transaction(async (tx) => {
      const result = await tx.branchMembership.updateMany({ where: { id: member.id, branchId, updatedAt: member.updatedAt }, data: { paySettingsJson: next } });
      if (result.count) await tx.changeLog.create({ data: { branchId, entityType: "employee_piecework", entityId: member.id, action: "update", oldValue: settings as never, newValue: next as never, performedByLogin: owner.session.user.login } });
      return result.count;
    });
    if (!saved) return NextResponse.json({ error: "Настройки изменились. Обновите страницу." }, { status: 409 });
    invalidatePayrollCache();
    return NextResponse.json({ removed: true });
  }

  const existing = await prisma.pieceworkRule.findUnique({
    where: { branchId_targetType_targetId_role: { branchId, targetType, targetId, role } },
  });
  if (!existing) return NextResponse.json({ removed: false });

  await prisma.pieceworkRule.delete({ where: { id: existing.id } });
  await logChange({
    entityType: "piecework_rule",
    entityId: existing.id,
    action: "delete",
    oldValue: {
      targetType: existing.targetType,
      targetId: existing.targetId,
      targetName: existing.targetName,
      role: existing.role,
      mode: existing.mode,
      fixedCents: existing.fixedCents,
      percentBasisPoints: existing.percentBasisPoints,
    },
    performedByLogin: owner.session.user.login,
  });
  invalidatePayrollCache();
  return NextResponse.json({ removed: true });
}
