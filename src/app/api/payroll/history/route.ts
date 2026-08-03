import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const PAYROLL_ENTITY_TYPES = [
  "piecework_rule",
  "shift_rate",
  "scheduled_working_day",
  "bonus_penalty",
  "payroll_period",
  "payroll_goal",
  "employee_recognition",
  "employee_motivation_settings",
];

function jsonHasLogin(value: unknown, login: string) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.userLogin === "string" && canonicalizeLogin(record.userLogin) === login;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(80, Math.floor(limitRaw))) : 30;

  const rows = await prisma.changeLog.findMany({
    where: { entityType: { in: PAYROLL_ENTITY_TYPES } },
    orderBy: { createdAt: "desc" },
    take: session.user.role === "owner" ? limit : Math.max(limit * 3, 30),
  });

  const visibleRows =
    session.user.role === "owner"
      ? rows
      : rows
          .filter(
            (row) =>
              row.performedByLogin === session.user.login ||
              jsonHasLogin(row.oldValue, session.user.login) ||
              jsonHasLogin(row.newValue, session.user.login)
          )
          .slice(0, limit);

  return NextResponse.json({
    history: visibleRows.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      oldValue: row.oldValue,
      newValue: row.newValue,
      performedByLogin: canonicalizeLogin(row.performedByLogin),
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
