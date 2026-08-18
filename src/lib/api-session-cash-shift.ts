import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentShift as getCashShift } from "@/lib/cashbox";
import { hasOpenCashShiftAccess } from "@/lib/cash-shift-access";

/** Проверка авторизации для операций, которые не изменяют рабочие данные. */
export async function requireApiSession(): Promise<
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
  return { ok: true, session };
}

/** Owner работает без кассы; для остальных нужна открытая кассовая смена. */
export async function requireApiSessionWithCashShift(): Promise<
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getSession>>> }
  | { ok: false; response: NextResponse }
> {
  const access = await requireApiSession();
  if (!access.ok) return access;
  const { session } = access;
  if (session.user.role === "owner") return { ok: true, session };

  const cashShift = await getCashShift();
  if (hasOpenCashShiftAccess(session.user.role, cashShift)) return { ok: true, session };

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Откройте кассовую смену", needCashShift: true },
      { status: 403 }
    ),
  };
}
