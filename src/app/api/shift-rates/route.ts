import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin, getLoginVariants, getSession, getUsersFromEnv } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getShiftRateCents } from "@/lib/shift-rates";
import { logChange } from "@/lib/change-log";
import { toLocalDateString } from "@/lib/time";

function getMonthEnd(yyyyMmDd: string) {
  const [year, month] = yyyyMmDd.split("-").map(Number);
  const last = new Date(year, month, 0);
  return toLocalDateString(last);
}

/** GET: текущая ставка для пользователя (или для списка логинов для владельца) */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const login = searchParams.get("login");
  if (session.user.role === "owner" && !login) {
    const today = toLocalDateString(new Date());
    const users = await getUsersFromEnv();
    const rates = await Promise.all(
      users.map(async (user) => ({
        login: user.login,
        name: user.name || user.login,
        amountCents: await getShiftRateCents(user.login, today),
      }))
    );
    return NextResponse.json({ rates });
  }

  const targetLogin = login ? canonicalizeLogin(login) : session.user.login;
  if (session.user.role !== "owner" && targetLogin !== session.user.login) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const today = toLocalDateString(new Date());
  const cents = await getShiftRateCents(targetLogin, today);
  return NextResponse.json({ login: targetLogin, amountCents: cents });
}

/** POST: владелец устанавливает ставку смены (действует на будущие смены). Body: { userLogin, amountCents } */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может менять ставки" }, { status: 403 });
  }

  const body = await request.json();
  const userLogin = typeof body.userLogin === "string" ? canonicalizeLogin(body.userLogin) : "";
  const amount = typeof body.amountCents === "number" ? body.amountCents : Number(body.amountCents);
  const amountCents = Math.round(amount);
  const effectiveFromRaw =
    typeof body.effectiveFrom === "string" && body.effectiveFrom.trim()
      ? body.effectiveFrom.trim()
      : null;
  const applyToMonth = body.applyToMonth === true;
  if (!userLogin || amountCents < 0) {
    return NextResponse.json({ error: "Укажите userLogin и amountCents (>= 0)" }, { status: 400 });
  }

  const effectiveFrom = effectiveFromRaw ?? toLocalDateString(new Date());
  if (applyToMonth) {
    const monthEnd = getMonthEnd(effectiveFrom);
    const existingInMonth = await prisma.shiftRate.findMany({
      where: {
        userLogin: { in: getLoginVariants(userLogin) },
        effectiveFrom: {
          gte: effectiveFrom,
          lte: monthEnd,
        },
      },
      orderBy: { effectiveFrom: "asc" },
    });

    const monthStartRate = existingInMonth.find((item) => item.effectiveFrom === effectiveFrom);

    const result = await prisma.$transaction(async (tx) => {
      let saved;
      if (monthStartRate) {
        saved = await tx.shiftRate.update({
          where: { id: monthStartRate.id },
          data: { userLogin, amountCents },
        });
      } else {
        saved = await tx.shiftRate.create({
          data: { userLogin, amountCents, effectiveFrom },
        });
      }

      const obsoleteIds = existingInMonth
        .filter((item) => item.id !== saved.id)
        .map((item) => item.id);

      if (obsoleteIds.length > 0) {
        await tx.shiftRate.deleteMany({
          where: { id: { in: obsoleteIds } },
        });
      }

      return { saved, obsoleteIds, monthStartRate };
    });

    await logChange({
      entityType: "shift_rate",
      entityId: result.saved.id,
      action: result.monthStartRate ? "update" : "create",
      oldValue: result.monthStartRate
        ? { userLogin, amountCents: result.monthStartRate.amountCents, effectiveFrom }
        : null,
      newValue: {
        userLogin,
        amountCents,
        effectiveFrom,
        appliedToMonth: true,
        removedRatesInMonth: result.obsoleteIds.length,
      },
      performedByLogin: session.user.login,
    });

    return NextResponse.json(result.saved);
  }

  const existing = await prisma.shiftRate.findFirst({
    where: { userLogin: { in: getLoginVariants(userLogin) }, effectiveFrom },
    orderBy: { effectiveFrom: "desc" },
  });

  if (existing) {
    const updated = await prisma.shiftRate.update({
      where: { id: existing.id },
      data: { userLogin, amountCents },
    });
    await logChange({
      entityType: "shift_rate",
      entityId: updated.id,
      action: "update",
      oldValue: { userLogin, amountCents: existing.amountCents, effectiveFrom },
      newValue: { userLogin, amountCents, effectiveFrom },
      performedByLogin: session.user.login,
    });
    return NextResponse.json(updated);
  }

  const created = await prisma.shiftRate.create({
    data: { userLogin, amountCents, effectiveFrom },
  });
  await logChange({
    entityType: "shift_rate",
    entityId: created.id,
    action: "create",
    newValue: { userLogin, amountCents, effectiveFrom },
    performedByLogin: session.user.login,
  });
  return NextResponse.json(created);
}
