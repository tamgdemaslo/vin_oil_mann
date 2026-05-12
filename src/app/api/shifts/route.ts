import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listShifts } from "@/lib/shifts";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const targetLogin = searchParams.get("user") ?? undefined;
  const dateFrom = searchParams.get("dateFrom") ?? undefined;
  const dateTo = searchParams.get("dateTo") ?? undefined;

  if (session.user.role !== "owner" && targetLogin && targetLogin !== session.user.login) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const shifts = await listShifts({
    userLogin: session.user.login,
    role: session.user.role,
    targetLogin,
    dateFrom,
    dateTo,
  });
  return NextResponse.json(shifts);
}
