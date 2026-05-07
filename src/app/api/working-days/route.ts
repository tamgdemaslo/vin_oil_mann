import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logChange } from "@/lib/change-log";

/** GET: список рабочих дней. Возвращает плановые дни и фактические смены. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const userLogin = searchParams.get("user") ?? (session.user.role === "owner" ? undefined : session.user.login);
  const dateFrom = searchParams.get("dateFrom") ?? undefined;
  const dateTo = searchParams.get("dateTo") ?? undefined;

  if (session.user.role !== "owner" && userLogin !== session.user.login) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const where: { userLogin?: string; date?: { gte?: string; lte?: string } } = {};
  if (userLogin) where.userLogin = userLogin;
  if (dateFrom) where.date = { ...where.date, gte: dateFrom };
  if (dateTo) where.date = { ...where.date, lte: dateTo };

  const shiftWhere: { userLogin?: string; shiftDate?: { gte?: string; lte?: string } } = {};
  if (userLogin) shiftWhere.userLogin = userLogin;
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
    merged.set(`${row.userLogin}:${row.date}`, {
      id: row.id,
      userLogin: row.userLogin,
      date: row.date,
      createdByLogin: row.createdByLogin,
      source: "scheduled",
      removable: true,
    });
  }

  for (const shift of shifts) {
    const key = `${shift.userLogin}:${shift.shiftDate}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, source: "both" });
      continue;
    }
    merged.set(key, {
      id: `actual:${shift.id}`,
      userLogin: shift.userLogin,
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
  const userLogin = typeof body.userLogin === "string" ? body.userLogin.trim() : "";
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
      toAdd.push(d.toISOString().slice(0, 10));
    }
  } else {
    return NextResponse.json({ error: "Укажите date или dateFrom и dateTo" }, { status: 400 });
  }

  const created: { id: string; userLogin: string; date: string }[] = [];
  for (const d of toAdd) {
    try {
      const row = await prisma.scheduledWorkingDay.upsert({
        where: { userLogin_date: { userLogin, date: d } },
        create: { userLogin, date: d, createdByLogin: session.user.login },
        update: {},
      });
      created.push({ id: row.id, userLogin: row.userLogin, date: row.date });
      await logChange({
        entityType: "scheduled_working_day",
        entityId: row.id,
        action: "create",
        newValue: { userLogin: row.userLogin, date: row.date },
        performedByLogin: session.user.login,
      });
    } catch {
      // дубликат — пропускаем
    }
  }
  return NextResponse.json({ added: created.length, items: created });
}
