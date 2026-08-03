import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { startShift } from "@/lib/shifts";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
    }
    if (session.user.role === "admin") {
      return NextResponse.json(
        { error: "Для администратора рабочая смена открывается через кассу" },
        { status: 400 }
      );
    }
    const result = await startShift(session.user.login);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result.shift);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка сервера";
    console.error("[POST /api/shifts/start]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
