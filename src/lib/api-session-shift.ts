import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentShift } from "@/lib/shifts";
import { getCurrentShift as getCashShift } from "@/lib/cashbox";
import { hasActiveShiftAccess } from "@/lib/active-shift-access";

/** Как на страницах отгрузки: owner без проверки смены; остальные — рабочая смена или кассовая. */
export async function requireApiSessionWithShift(): Promise<
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getSession>>> }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }),
    };
  }
  if (session.user.role === "owner") {
    return { ok: true, session };
  }
  const workShift = await getCurrentShift(session.user.login);
  const cashOpen = await getCashShift();
  if (hasActiveShiftAccess(session.user.role, workShift, cashOpen)) {
    return { ok: true, session };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Откройте смену", needShift: true },
      { status: 403 }
    ),
  };
}
