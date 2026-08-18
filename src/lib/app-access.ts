import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCurrentShift as getCurrentCashShift } from "@/lib/cashbox";
import { hasOpenCashShiftAccess } from "@/lib/cash-shift-access";

export async function requireAuthenticatedSession(from: string) {
  const session = await getSession();
  if (!session) redirect(`/login?from=${from}`);
  return session;
}

export async function requireOpenCashShiftAccess(from: string) {
  const session = await requireAuthenticatedSession(from);
  if (session.user.role === "owner") return session;

  const currentCashShift = await getCurrentCashShift();
  if (hasOpenCashShiftAccess(session.user.role, currentCashShift)) {
    return session;
  }

  redirect(session.user.role === "admin" ? "/cash?needCashShift=1" : "/?needCashShift=1");
}
