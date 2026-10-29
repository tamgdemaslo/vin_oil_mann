import { prisma } from "@/lib/db";
import { simpleCaseDeadline, simpleCaseStatus } from "@/lib/client-case-simple";

/** Live branch state: badges and overdue alerts never depend on a delivery log. */
export async function getClientCaseAlertSnapshot(branchId: string, since: Date | null, now = new Date()) {
  const rows = await prisma.crmDeal.findMany({
    where: { branchId, status: "open", caseStatus: { notIn: ["closed", "cancelled", "duplicate"] } },
    select: { id: true, title: true, customerName: true, phoneNormalized: true, responsibleLogin: true, status: true, caseStatus: true, nextAction: true, createdAt: true, nextActionAt: true, nextContactAt: true, snoozeUntil: true, stage: { select: { name: true } } },
  });
  const active = rows.filter(row => simpleCaseStatus(row) !== "closed");
  const overdue = active.filter(row => {
    const due = simpleCaseDeadline(row);
    return due && due < now;
  });
  return {
    serverTime: now.toISOString(),
    clientCaseAttention: {
      overdue: overdue.length,
      calculationNeeded: active.filter(row => simpleCaseStatus(row) === "calculation_needed").length,
    },
    newCases: since ? active.filter(row => row.createdAt > since && row.createdAt <= now).map(row => ({
      id: row.id, title: row.title, createdAt: row.createdAt.toISOString(), href: `/crm?dealId=${encodeURIComponent(row.id)}`,
    })) : [],
    overdue: overdue.filter(row => !row.snoozeUntil || row.snoozeUntil <= now).map(row => {
      const deadline = simpleCaseDeadline(row)!;
      return {
        id: `live:${row.id}`, caseId: row.id, type: "overdue_repeat" as const, urgency: "overdue" as const,
        title: "Просрочено дело клиента", body: `${row.customerName || row.title}: ${row.nextAction || row.title}`,
        caseTitle: row.title, client: row.customerName || row.title, nextAction: row.nextAction || row.title,
        deadline: deadline.toISOString(), phone: row.phoneNormalized,
        href: `/crm?dealId=${encodeURIComponent(row.id)}`, sentAt: deadline.toISOString(),
      };
    }).sort((a, b) => a.deadline.localeCompare(b.deadline)),
  };
}
