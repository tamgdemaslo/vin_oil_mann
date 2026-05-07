import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { endShift } from "@/lib/shifts";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  }
  if (session.user.role === "admin") {
    return NextResponse.json(
      { error: "Для администратора рабочая смена закрывается через кассу" },
      { status: 400 }
    );
  }
  const result = await endShift(session.user.login);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
