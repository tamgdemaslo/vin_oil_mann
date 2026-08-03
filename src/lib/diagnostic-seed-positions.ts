import type { DiagnosticBlock, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { filterNodesForVehicle, type VehicleHints } from "@/data/diagnostic-catalog";
import { updateDiagnosticSummaryCounts } from "@/lib/diagnostic-regenerate-offers";

export async function seedDiagnosticPositionsIfEmpty(
  diagnosticId: string,
  hints?: VehicleHints
): Promise<void> {
  const count = await prisma.diagnosticPosition.count({ where: { diagnosticId } });
  if (count > 0) return;
  const nodes = filterNodesForVehicle(hints);
  if (nodes.length === 0) return;
  await prisma.diagnosticPosition.createMany({
    data: nodes.map((n) => ({
      diagnosticId,
      block: n.block as DiagnosticBlock,
      node: n.node,
      tags: [],
    })),
  });
}

export async function syncDiagnosticPositionsForVehicleHints(
  diagnosticId: string,
  hints: VehicleHints
): Promise<void> {
  const nodes = filterNodesForVehicle(hints);
  const activeNodes = new Set(nodes.map((node) => node.node));
  const existing = await prisma.diagnosticPosition.findMany({
    where: { diagnosticId },
    include: { _count: { select: { photos: true } } },
  });
  const existingNodes = new Set(existing.map((position) => position.node));
  const missingNodes = nodes.filter((node) => !existingNodes.has(node.node));
  const staleUntouchedIds = existing
    .filter((position) => {
      if (activeNodes.has(position.node)) return false;
      return (
        position.status === "NOT_CHECKED" &&
        position.tags.length === 0 &&
        position.measurementValue == null &&
        !position.measurementUnit &&
        !position.recommendation &&
        !position.notes &&
        position._count.photos === 0
      );
    })
    .map((position) => position.id);

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (missingNodes.length > 0) {
    operations.push(
      prisma.diagnosticPosition.createMany({
        data: missingNodes.map((node) => ({
          diagnosticId,
          block: node.block as DiagnosticBlock,
          node: node.node,
          tags: [],
        })),
        skipDuplicates: true,
      })
    );
  }
  if (staleUntouchedIds.length > 0) {
    operations.push(
      prisma.diagnosticPosition.deleteMany({
        where: { id: { in: staleUntouchedIds } },
      })
    );
  }

  if (operations.length > 0) await prisma.$transaction(operations);

  await updateDiagnosticSummaryCounts(diagnosticId);
}
