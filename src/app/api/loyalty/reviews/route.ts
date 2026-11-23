import { prisma } from "@/lib/db";
import { loyaltyProgram, loyaltyScope } from "@/lib/loyalty/accounts";
import { loyaltyApi } from "@/lib/loyalty/http";

export function GET() {
  return loyaltyApi("manager", async (context) => {
    const scope = loyaltyScope(context);
    if (!(await loyaltyProgram(prisma, scope.businessGroupId)).enabled) return { enabled: false, clients: [] };
    const rows = await prisma.loyaltyLink.findMany({
      where: { businessGroupId: scope.businessGroupId, branchId: scope.branchId, review: true },
      select: { counterpartyId: true }, orderBy: { updatedAt: "asc" }, take: 200,
    });
    const clients = await prisma.localCounterparty.findMany({
      where: { branchId: scope.branchId, archived: false, id: { in: rows.map((row) => row.counterpartyId) } },
      select: { id: true, name: true, displayName: true }, orderBy: { name: "asc" },
    });
    return { enabled: true, clients };
  });
}
