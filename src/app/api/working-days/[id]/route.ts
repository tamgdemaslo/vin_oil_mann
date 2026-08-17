import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { logChange } from "@/lib/change-log";

/** DELETE: владелец снимает назначенную смену. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const session = { user: access.context.user };
    if (session.user.role !== "owner") {
      return NextResponse.json({ error: "Только владелец может снимать смены" }, { status: 403 });
    }

    const { id } = await params;
    const row = await prisma.scheduledWorkingDay.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });

    await prisma.scheduledWorkingDay.delete({ where: { id } });
    await logChange({
      entityType: "employee_shift",
      entityId: id,
      action: "delete",
      oldValue: { userLogin: row.userLogin, date: row.date },
      performedByLogin: session.user.login,
    });
    return NextResponse.json({ ok: true });
  });
}
