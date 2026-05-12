import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCurrentShift as getCurrentCashShift } from "@/lib/cashbox";
import { getCurrentShift } from "@/lib/shifts";

export async function requireAuthenticatedSession(from: string) {
  const session = await getSession();
  if (!session) redirect(`/login?from=${from}`);
  return session;
}

export async function requireActiveShiftAccess(from: string) {
  const session = await requireAuthenticatedSession(from);
  if (session.user.role === "owner") return session;

  const currentShift = await getCurrentShift(session.user.login);
  const currentCashShift = getCurrentCashShift();
  if (currentShift || currentCashShift) {
    return session;
  }

  redirect(session.user.role === "admin" ? "/cash?needShift=1" : "/?needShift=1");
}
