import { prisma } from "@/lib/db";
import { simpleCaseDeadline, simpleCaseStatus } from "@/lib/client-case-simple";

export type ClientCaseAttention = { overdue: number; calculationNeeded: number };

export async function getClientCaseAttention(branchId: string, now = new Date()): Promise<ClientCaseAttention> {
  const rows = await prisma.crmDeal.findMany({
    where: {
      branchId,
      status: "open",
      caseStatus: { notIn: ["closed", "cancelled", "duplicate"] },
      NOT: ["закры", "оплач", "потер", "отказ", "дубль", "архив", "lost"].map(word => ({
        stage: { name: { contains: word, mode: "insensitive" as const } },
      })),
    },
    select: { status: true, caseStatus: true, nextAction: true, createdAt: true, nextActionAt: true, nextContactAt: true, suppliesExpectedAt: true, stage: { select: { name: true } } },
  });
  return rows.reduce((counts, row) => {
    const due = simpleCaseDeadline(row);
    if (due && due < now) counts.overdue += 1;
    if (simpleCaseStatus(row) === "calculation_needed") counts.calculationNeeded += 1;
    return counts;
  }, { overdue: 0, calculationNeeded: 0 });
}
