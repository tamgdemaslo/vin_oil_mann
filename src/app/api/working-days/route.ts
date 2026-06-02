import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin, getLoginVariants, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logChange } from "@/lib/change-log";

function dateOnlyKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** GET: список рабочих дней. Возвращает плановые дни и фактические смены. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

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

  const shiftWhere: { userLogin?: string | { in: string[] }; shiftDate?: { gte?: string; lte?: string } } = {};
  if (userLogin) shiftWhere.userLogin = { in: getLoginVariants(userLogin) };
  if (dateFrom) shiftWhere.shiftDate = { ...shiftWhere.shiftDate, gte: dateFrom };
  if (dateTo) shiftWhere.shiftDate = { ...shiftWhere.shiftDate, lte: dateTo };

  const [scheduledDays, shifts] = await Promise.all([
    prisma.scheduledWorkingDay.findMany({
      where,
      orderBy: [{ date: "desc" }],
    }),
    prisma.shift.findMany({
      where: shiftWhere,
      select: { id: true, userLogin: true, shiftDate: true },
      orderBy: [{ shiftDate: "desc" }],
    }),
  ]);

  const merged = new Map<
    string,
    {
      id: string;
      userLogin: string;
      date: string;
      createdByLogin: string;
      source: "scheduled" | "actual" | "both";
      removable: boolean;
    }
  >();

  for (const row of scheduledDays) {
    const rowUserLogin = canonicalizeLogin(row.userLogin);
    merged.set(`${rowUserLogin}:${row.date}`, {
      id: row.id,
      userLogin: rowUserLogin,
      date: row.date,
      createdByLogin: canonicalizeLogin(row.createdByLogin),
      source: "scheduled",
      removable: true,
    });
  }

  for (const shift of shifts) {
    const shiftUserLogin = canonicalizeLogin(shift.userLogin);
    const key = `${shiftUserLogin}:${shift.shiftDate}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, source: "both" });
      continue;
    }
    merged.set(key, {
      id: `actual:${shift.id}`,
      userLogin: shiftUserLogin,
      date: shift.shiftDate,
      createdByLogin: "system",
      source: "actual",
      removable: false,
    });
  }

  const list = Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
  return NextResponse.json(list);
}

/** POST: владелец назначает рабочий день (или диапазон). Body: { userLogin, date } или { userLogin, dateFrom, dateTo } */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может назначать рабочие дни" }, { status: 403 });
  }

  const body = await request.json();
  const userLogin = typeof body.userLogin === "string" ? canonicalizeLogin(body.userLogin) : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom.trim() : "";
  const dateTo = typeof body.dateTo === "string" ? body.dateTo.trim() : "";

  if (!userLogin) {
    return NextResponse.json({ error: "Укажите userLogin" }, { status: 400 });
  }

  const toAdd: string[] = [];
  if (date) {
    toAdd.push(date);
  } else if (dateFrom && dateTo) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (from > to) {
      return NextResponse.json({ error: "dateFrom не должен быть позже dateTo" }, { status: 400 });
    }
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      toAdd.push(dateOnlyKey(d));
    }
  } else {
    return NextResponse.json({ error: "Укажите date или dateFrom и dateTo" }, { status: 400 });
  }

  const created: { id: string; userLogin: string; date: string }[] = [];
  for (const d of toAdd) {
    try {
      const existing = await prisma.scheduledWorkingDay.findFirst({
        where: { userLogin: { in: getLoginVariants(userLogin) }, date: d },
      });
      const row =
        existing ??
        (await prisma.scheduledWorkingDay.create({
          data: { userLogin, date: d, createdByLogin: session.user.login },
        }));
      created.push({ id: row.id, userLogin: canonicalizeLogin(row.userLogin), date: row.date });
      await logChange({
        entityType: "scheduled_working_day",
        entityId: row.id,
        action: "create",
        newValue: { userLogin: canonicalizeLogin(row.userLogin), date: row.date },
        performedByLogin: session.user.login,
      });
    } catch {
      // дубликат — пропускаем
    }
  }
  return NextResponse.json({ added: created.length, items: created });
}
