import { getLoginVariants } from "@/lib/auth";
import { requireBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

async function activeBranchId() {
  const context = await requireBranchContext({ allowAll: false, requireActive: true });
  if (!context.branchId) throw new Error("Активный филиал не выбран");
  return context.branchId;
}

/** Найти ставку назначенной смены для сотрудника на дату. */
export async function getShiftRateCents(userLogin: string, shiftDate: string): Promise<number | null> {
  const branchId = await activeBranchId();
  const row = await prisma.shiftRate.findFirst({
    where: {
      branchId,
      userLogin: { in: getLoginVariants(userLogin) },
      effectiveFrom: { lte: shiftDate },
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return row?.amountCents ?? null;
}
