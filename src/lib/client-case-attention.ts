import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ClientCaseAttention = { overdue: number; calculationNeeded: number };

export async function getClientCaseAttention(branchId: string, now = new Date()): Promise<ClientCaseAttention> {
  const active: Prisma.CrmDealWhereInput = {
    branchId,
    status: "open",
    caseStatus: { notIn: ["closed", "cancelled", "duplicate"] },
    OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }],
    NOT: ["закры", "оплач", "потер", "отказ", "дубль", "архив", "lost"].map(word => ({
      stage: { name: { contains: word, mode: "insensitive" as const } },
    })),
  };
  const [overdue, calculationNeeded] = await Promise.all([
    prisma.crmDeal.count({ where: { AND: [active, { OR: [
      { nextActionAt: { lt: now } },
      { nextActionAt: null, nextContactAt: { lt: now } },
    ] }] } }),
    prisma.crmDeal.count({ where: { AND: [active, { caseStatus: "calculation_needed" }] } }),
  ]);
  return { overdue, calculationNeeded };
}
