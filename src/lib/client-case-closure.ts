import { prisma } from "@/lib/db";

type ClosedCase = { id: string; status?: string; closedAt?: Date | string | null };

/** Read the closing action, never infer its author from the case creator or last editor. */
export async function caseClosureById(cases: ClosedCase[], branchId: string) {
  const closed = cases.filter(row => row.status && row.status !== "open");
  const result = new Map<string, { actorLogin: string | null; closedAt: Date | string | null }>();
  for (const row of closed) result.set(row.id, { actorLogin: null, closedAt: row.closedAt ?? null });
  if (!closed.length) return result;
  let events;
  try {
    events = await prisma.clientCaseEvent.findMany({
      where: { branchId, caseId: { in: closed.map(row => row.id) }, eventType: { in: ["close", "confirm_manual_booking", "refused", "duplicate"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["caseId"],
      select: { caseId: true, actorLogin: true, createdAt: true },
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("client_case_events")) throw error;
    return result;
  }
  for (const event of events) {
    const current = result.get(event.caseId);
    if (!current) continue;
    // An earlier closing event must not claim a later closure after reopening.
    if (current.closedAt && event.createdAt.getTime() < new Date(current.closedAt).getTime() - 1000) continue;
    result.set(event.caseId, { actorLogin: event.actorLogin, closedAt: current.closedAt ?? event.createdAt });
  }
  return result;
}
