import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin, getLoginVariants, getUsersFromEnv } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

const MAX_BULK_SHIFT_CHANGES = 500;

type ShiftAssignment = {
  userLogin: string;
  date: string;
};

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shiftKey(userLogin: string, date: string): string {
  return `${canonicalizeLogin(userLogin).toLowerCase()}:${date}`;
}

function dateRangeKeys(dateFrom: string, dateTo: string): string[] | null {
  if (!isDateKey(dateFrom) || !isDateKey(dateTo) || dateFrom > dateTo) return null;
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  const dates: string[] = [];
  for (let date = from; date <= to; date = new Date(date.getTime() + 86_400_000)) {
    dates.push(date.toISOString().slice(0, 10));
    if (dates.length > MAX_BULK_SHIFT_CHANGES) return null;
  }
  return dates;
}

function requestedAssignments(body: Record<string, unknown>): ShiftAssignment[] | null {
  const assignments: ShiftAssignment[] = [];
  if (Array.isArray(body.assignments)) {
    if (body.assignments.length > MAX_BULK_SHIFT_CHANGES) return null;
    for (const item of body.assignments) {
      if (!item || typeof item !== "object") return null;
      const userLogin = typeof (item as { userLogin?: unknown }).userLogin === "string"
        ? canonicalizeLogin((item as { userLogin: string }).userLogin)
        : "";
      const date = typeof (item as { date?: unknown }).date === "string"
        ? (item as { date: string }).date.trim()
        : "";
      if (!userLogin || !isDateKey(date)) return null;
      assignments.push({ userLogin, date });
    }
  } else {
    const rawUserLogins = Array.isArray(body.userLogins)
      ? body.userLogins
      : [body.userLogin];
    const userLogins = rawUserLogins
      .filter((value): value is string => typeof value === "string")
      .map(canonicalizeLogin)
      .filter(Boolean);

    let dates: string[] | null = null;
    if (Array.isArray(body.dates)) {
      dates = body.dates
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim());
      if (dates.some((date) => !isDateKey(date))) return null;
    } else if (typeof body.date === "string" && body.date.trim()) {
      dates = [body.date.trim()];
    } else if (typeof body.dateFrom === "string" && typeof body.dateTo === "string") {
      dates = dateRangeKeys(body.dateFrom.trim(), body.dateTo.trim());
    }
    if (!dates || userLogins.length === 0 || dates.some((date) => !isDateKey(date))) return null;
    for (const userLogin of userLogins) {
      for (const date of dates) {
        assignments.push({ userLogin, date });
        if (assignments.length > MAX_BULK_SHIFT_CHANGES) return null;
      }
    }
  }

  const unique = new Map<string, ShiftAssignment>();
  for (const assignment of assignments) unique.set(shiftKey(assignment.userLogin, assignment.date), assignment);
  return unique.size > 0 && unique.size <= MAX_BULK_SHIFT_CHANGES ? Array.from(unique.values()) : null;
}

/** GET: список назначенных смен для зарплаты. URL сохранён для обратной совместимости. */
export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const session = { user: access.context.user };
    const { searchParams } = new URL(request.url);
    const requestedUserLogin = searchParams.get("user") ?? (session.user.role === "owner" ? undefined : session.user.login);
    const userLogin = requestedUserLogin ? canonicalizeLogin(requestedUserLogin) : undefined;
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;

    if (session.user.role !== "owner" && userLogin !== session.user.login) {
      return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    const where: { userLogin?: string | { in: string[] }; date?: { gte?: string; lte?: string } } = {};
    if (userLogin) where.userLogin = { in: getLoginVariants(userLogin) };
    if (dateFrom) where.date = { ...where.date, gte: dateFrom };
    if (dateTo) where.date = { ...where.date, lte: dateTo };

    const [scheduledShifts, users] = await Promise.all([
      prisma.scheduledWorkingDay.findMany({
        where,
        orderBy: [{ date: "desc" }],
      }),
      getUsersFromEnv(),
    ]);
    const payrollLogins = new Set(
      users.filter((user) => user.role === "master" || user.role === "admin").map((user) => canonicalizeLogin(user.login).toLowerCase())
    );

    const list = scheduledShifts
      .map((row) => ({
        id: row.id,
        userLogin: canonicalizeLogin(row.userLogin),
        date: row.date,
        createdByLogin: canonicalizeLogin(row.createdByLogin),
      }))
      .filter((row) => payrollLogins.has(row.userLogin.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));
    return NextResponse.json(list);
  });
}

/** POST: владелец назначает смену сотруднику (или диапазон). */
export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const session = { user: access.context.user };
    if (session.user.role !== "owner") {
      return NextResponse.json({ error: "Только владелец может назначать смены сотрудников" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Некорректные данные смен" }, { status: 400 });
    }
    const assignments = requestedAssignments(body as Record<string, unknown>);
    if (!assignments) {
      return NextResponse.json({ error: `Укажите от 1 до ${MAX_BULK_SHIFT_CHANGES} корректных назначений смен` }, { status: 400 });
    }

    const users = await getUsersFromEnv();
    const payrollUsers = new Map(
      users
        .filter((user) => user.role === "master" || user.role === "admin")
        .map((user) => [canonicalizeLogin(user.login).toLowerCase(), canonicalizeLogin(user.login)])
    );
    if (assignments.some((assignment) => !payrollUsers.has(assignment.userLogin.toLowerCase()))) {
      return NextResponse.json({ error: "Смены для зарплаты назначаются только мастерам и администраторам" }, { status: 400 });
    }

    const normalizedAssignments = assignments.map((assignment) => ({
      userLogin: payrollUsers.get(assignment.userLogin.toLowerCase())!,
      date: assignment.date,
    }));
    const branchId = access.context.branchId!;
    const dates = Array.from(new Set(normalizedAssignments.map((assignment) => assignment.date)));
    const loginVariants = Array.from(new Set(normalizedAssignments.flatMap((assignment) => getLoginVariants(assignment.userLogin))));
    const assignmentKeys = new Set(normalizedAssignments.map((assignment) => shiftKey(assignment.userLogin, assignment.date)));

    const result = await prisma.$transaction(async (transaction) => {
      const existingRows = await transaction.scheduledWorkingDay.findMany({
        where: { branchId, userLogin: { in: loginVariants }, date: { in: dates } },
      });
      const existingKeys = new Set(existingRows.map((row) => shiftKey(row.userLogin, row.date)));
      const missing = normalizedAssignments.filter((assignment) => !existingKeys.has(shiftKey(assignment.userLogin, assignment.date)));

      if (missing.length > 0) {
        await transaction.scheduledWorkingDay.createMany({
          data: missing.map((assignment) => ({
            branchId,
            userLogin: assignment.userLogin,
            date: assignment.date,
            createdByLogin: session.user.login,
          })),
          skipDuplicates: true,
        });
      }

      const rows = await transaction.scheduledWorkingDay.findMany({
        where: { branchId, userLogin: { in: loginVariants }, date: { in: dates } },
        orderBy: [{ date: "asc" }, { userLogin: "asc" }],
      });
      const itemsByKey = new Map(
        rows
          .filter((row) => assignmentKeys.has(shiftKey(row.userLogin, row.date)))
          .map((row) => [shiftKey(row.userLogin, row.date), row])
      );
      const missingKeys = new Set(missing.map((assignment) => shiftKey(assignment.userLogin, assignment.date)));
      const createdRows = Array.from(itemsByKey.entries())
        .filter(([key]) => missingKeys.has(key))
        .map(([, row]) => row);

      if (createdRows.length > 0) {
        await transaction.changeLog.createMany({
          data: createdRows.map((row) => ({
            branchId,
            entityType: "employee_shift",
            entityId: row.id,
            action: "create",
            newValue: { userLogin: canonicalizeLogin(row.userLogin), date: row.date },
            performedByLogin: session.user.login,
          })),
        });
      }

      return {
        added: createdRows.length,
        items: Array.from(itemsByKey.values()).map((row) => ({
          id: row.id,
          userLogin: canonicalizeLogin(row.userLogin),
          date: row.date,
        })),
      };
    });

    return NextResponse.json(result);
  });
}

/** DELETE: владелец снимает несколько назначенных смен одним запросом. */
export async function DELETE(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    if (access.context.user.role !== "owner") {
      return NextResponse.json({ error: "Только владелец может снимать смены сотрудников" }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const rawIds: unknown[] = body && typeof body === "object" && Array.isArray((body as { ids?: unknown }).ids)
      ? (body as { ids: unknown[] }).ids
      : [];
    const ids: string[] = Array.from(new Set(
      rawIds
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    ));
    if (ids.length === 0 || ids.length > MAX_BULK_SHIFT_CHANGES) {
      return NextResponse.json({ error: `Укажите от 1 до ${MAX_BULK_SHIFT_CHANGES} смен для удаления` }, { status: 400 });
    }

    const branchId = access.context.branchId!;
    const removed = await prisma.$transaction(async (transaction) => {
      const rows = await transaction.scheduledWorkingDay.findMany({ where: { branchId, id: { in: ids } } });
      if (rows.length === 0) return [];
      await transaction.scheduledWorkingDay.deleteMany({ where: { branchId, id: { in: rows.map((row) => row.id) } } });
      await transaction.changeLog.createMany({
        data: rows.map((row) => ({
          branchId,
          entityType: "employee_shift",
          entityId: row.id,
          action: "delete",
          oldValue: { userLogin: canonicalizeLogin(row.userLogin), date: row.date },
          performedByLogin: access.context.user.login,
        })),
      });
      return rows;
    });
    return NextResponse.json({ removed: removed.length });
  });
}
