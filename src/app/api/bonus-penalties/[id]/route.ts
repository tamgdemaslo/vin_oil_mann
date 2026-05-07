import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logChange } from "@/lib/change-log";

/** PATCH: только владелец может редактировать. Body: { date?, amountCents?, type?, comment? } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может редактировать" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.bonusPenalty.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const body = await request.json();
  const date = typeof body.date === "string" ? body.date.trim() : existing.date;
  const amountCents = typeof body.amountCents === "number" ? body.amountCents : existing.amountCents;
  const type = (body.type === "penalty_manual" || body.type === "bonus") ? body.type : existing.type;
  const comment = body.comment !== undefined ? (typeof body.comment === "string" ? body.comment.trim() || null : null) : existing.comment;

  const updated = await prisma.bonusPenalty.update({
    where: { id },
    data: { date, amountCents, type, comment },
  });
  await logChange({
    entityType: "bonus_penalty",
    entityId: id,
    action: "update",
    oldValue: { date: existing.date, amountCents: existing.amountCents, type: existing.type, comment: existing.comment },
    newValue: { date: updated.date, amountCents: updated.amountCents, type: updated.type, comment: updated.comment },
    performedByLogin: session.user.login,
  });
  return NextResponse.json(updated);
}

/** DELETE: только владелец может удалять (в любые дни) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может удалять" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.bonusPenalty.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  await prisma.bonusPenalty.delete({ where: { id } });
  await logChange({
    entityType: "bonus_penalty",
    entityId: id,
    action: "delete",
    oldValue: { userLogin: existing.userLogin, date: existing.date, amountCents: existing.amountCents, type: existing.type },
    performedByLogin: session.user.login,
  });
  return NextResponse.json({ ok: true });
}
