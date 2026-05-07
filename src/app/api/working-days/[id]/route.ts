import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logChange } from "@/lib/change-log";

/** DELETE: владелец удаляет назначенный рабочий день */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может удалять рабочие дни" }, { status: 403 });
  }

  const { id } = await params;
  const row = await prisma.scheduledWorkingDay.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  await prisma.scheduledWorkingDay.delete({ where: { id } });
  await logChange({
    entityType: "scheduled_working_day",
    entityId: id,
    action: "delete",
    oldValue: { userLogin: row.userLogin, date: row.date },
    performedByLogin: session.user.login,
  });
  return NextResponse.json({ ok: true });
}
