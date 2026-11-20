import { prisma } from "@/lib/db";
import { reviewedMannApplications } from "@/lib/mann-reviewed-applications";

/** The same selected catalogue identity feeds filters, DB knowledge and research. */
export async function loadSelectedMannApplications(variantKeys: string[]) {
  const rows = await prisma.mannFilterApplication.findMany({
    where: { vehicleVariantKey: { in: variantKeys } },
    select: { vehicleVariantKey: true, make: true, model: true, effectiveVehicleText: true, vehicleText: true,
      engineCode: true, vehicleYears: true, modelYears: true, kw: true, hp: true },
  });
  return [...rows, ...reviewedMannApplications(variantKeys).filter(row => !rows.some(existing => existing.vehicleVariantKey === row.vehicleVariantKey))];
}
