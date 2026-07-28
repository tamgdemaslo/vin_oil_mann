import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  PieceworkMode,
  PieceworkRole,
  PieceworkTargetType,
  isAllowedPieceworkRule,
  listPieceworkRules,
} from "@/lib/piecework-rules";
import { logChange } from "@/lib/change-log";
import { requireBranchApi } from "@/lib/branch-api";

function isRole(value: string): value is PieceworkRole {
  return value === "master" || value === "admin";
}

function isTargetType(value: string): value is PieceworkTargetType {
  return value === "service" || value === "product_group";
}

function isMode(value: string): value is PieceworkMode {
  return value === "fixed" || value === "percent";
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может смотреть правила" }, { status: 403 });
  }
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const rules = await listPieceworkRules(branchAccess.context.branchId!);
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может менять правила" }, { status: 403 });
  }
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const branchId = branchAccess.context.branchId!;

  const body = await request.json();
  const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  const targetName = typeof body.targetName === "string" ? body.targetName.trim() : "";
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode.trim() : "";
  const fixedRaw =
    body.fixedCents == null ? null : typeof body.fixedCents === "number" ? body.fixedCents : Number(body.fixedCents);
  const percentRaw =
    body.percentBasisPoints == null
      ? null
      : typeof body.percentBasisPoints === "number"
        ? body.percentBasisPoints
        : Number(body.percentBasisPoints);

  if (!isTargetType(targetType) || !targetId || !targetName || !isRole(role) || !isMode(mode)) {
    return NextResponse.json({ error: "Некорректные данные правила" }, { status: 400 });
  }
  if (!isAllowedPieceworkRule(targetType, role)) {
    return NextResponse.json(
      { error: "Для мастера можно задавать только услуги, а для администратора только группы товаров" },
      { status: 400 }
    );
  }

  const fixedCents = fixedRaw == null ? null : Math.round(fixedRaw);
  const percentBasisPoints = percentRaw == null ? null : Math.round(percentRaw);

  if (mode === "fixed" && (fixedCents == null || fixedCents < 0)) {
    return NextResponse.json({ error: "Для фиксированной выплаты укажите сумму >= 0" }, { status: 400 });
  }
  if (mode === "percent" && (percentBasisPoints == null || percentBasisPoints < 0)) {
    return NextResponse.json({ error: "Для процента укажите значение >= 0" }, { status: 400 });
  }

  const existing = await prisma.pieceworkRule.findUnique({
    where: {
      branchId_targetType_targetId_role: {
        branchId,
        targetType,
        targetId,
        role,
      },
    },
  });

  const saved = existing
    ? await prisma.pieceworkRule.update({
        where: { id: existing.id },
        data: {
          branchId,
          targetName,
          mode,
          fixedCents: mode === "fixed" ? fixedCents : null,
          percentBasisPoints: mode === "percent" ? percentBasisPoints : null,
        },
      })
    : await prisma.pieceworkRule.create({
        data: {
          branchId,
          targetType,
          targetId,
          targetName,
          role,
          mode,
          fixedCents: mode === "fixed" ? fixedCents : null,
          percentBasisPoints: mode === "percent" ? percentBasisPoints : null,
        },
      });

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
    newValue: {
      targetType,
      targetId,
      targetName,
      role,
      mode,
      fixedCents: mode === "fixed" ? fixedCents : null,
      percentBasisPoints: mode === "percent" ? percentBasisPoints : null,
    },
    performedByLogin: session.user.login,
  });

  return NextResponse.json(saved);
}
