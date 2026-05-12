import type { DiagnosticBlock } from "@prisma/client";
import { prisma } from "@/lib/db";
import { filterNodesForVehicle, type VehicleHints } from "@/data/diagnostic-catalog";

export async function seedDiagnosticPositionsIfEmpty(
  diagnosticId: string,
  hints?: VehicleHints
): Promise<void> {
  const count = await prisma.diagnosticPosition.count({ where: { diagnosticId } });
  if (count > 0) return;
  const nodes = filterNodesForVehicle(hints);
  await prisma.diagnosticPosition.createMany({
    data: nodes.map((n) => ({
      diagnosticId,
      block: n.block as DiagnosticBlock,
      node: n.node,
      tags: [],
    })),
  });
}
