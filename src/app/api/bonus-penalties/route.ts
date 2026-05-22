import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin, getLoginVariants, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** GET: список бонусов/штрафов. Владелец может фильтровать по user, dateFrom, dateTo. */
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

  const list = await prisma.bonusPenalty.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(
    list.map((item) => ({
      ...item,
      userLogin: canonicalizeLogin(item.userLogin),
      createdByLogin: canonicalizeLogin(item.createdByLogin),
    }))
  );
}

/** POST: владелец создаёт бонус или штраф. Body: { userLogin, date, amountCents, type, comment? } type: bonus | penalty_manual */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может создавать бонусы и штрафы" }, { status: 403 });
  }

  const body = await request.json();
  const userLogin = typeof body.userLogin === "string" ? canonicalizeLogin(body.userLogin) : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const amountCents = typeof body.amountCents === "number" ? body.amountCents : Number(body.amountCents);
  const type = (body.type === "penalty_manual" || body.type === "bonus") ? body.type : "bonus";
  const comment = typeof body.comment === "string" ? body.comment.trim() || null : null;

  if (!userLogin || !date || Number.isNaN(amountCents)) {
    return NextResponse.json({ error: "Укажите userLogin, date (YYYY-MM-DD), amountCents" }, { status: 400 });
  }
  const value = type === "bonus" ? Math.abs(amountCents) : -Math.abs(amountCents);

  const created = await prisma.bonusPenalty.create({
    data: {
      userLogin,
      date,
      amountCents: value,
      type,
      comment,
      createdByLogin: session.user.login,
    },
  });
  const { logChange } = await import("@/lib/change-log");
  await logChange({
    entityType: "bonus_penalty",
    entityId: created.id,
    action: "create",
    newValue: { userLogin, date, amountCents: value, type, comment },
    performedByLogin: session.user.login,
  });
  return NextResponse.json(created);
}
