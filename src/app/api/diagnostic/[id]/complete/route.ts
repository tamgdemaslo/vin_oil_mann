import { NextRequest, NextResponse } from "next/server";
import { ALL_NODES } from "@/data/diagnostic-catalog";
import { prisma } from "@/lib/db";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import {
  regenerateOffersForDiagnostic,
  updateDiagnosticSummaryCounts,
} from "@/lib/diagnostic-regenerate-offers";

type DiagnosticCompleteBlocker = {
  positionId: string;
  node: string;
  nodeLabel: string;
  reason: "missing_photo" | "missing_required_field";
  message: string;
};

function nodeLabel(node: string): string {
  return ALL_NODES.find((item) => item.node === node)?.title ?? node;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const diag = await prisma.diagnostic.findUnique({ where: { id } });
  if (!diag) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const positions = await prisma.diagnosticPosition.findMany({
    where: { diagnosticId: id },
    include: { photos: true },
  });

  const blockers: DiagnosticCompleteBlocker[] = [];
  for (const position of positions) {
    const label = nodeLabel(position.node);
    if ((position.status === "YELLOW" || position.status === "RED") && position.photos.length < 1) {
      blockers.push({
        positionId: position.id,
        node: position.node,
        nodeLabel: label,
        reason: "missing_photo",
        message: `${label} — нет фото`,
      });
    }
    if (position.status === "SKIPPED" && !position.notes?.trim()) {
      blockers.push({
        positionId: position.id,
        node: position.node,
        nodeLabel: label,
        reason: "missing_required_field",
        message: `${label} — укажите причину пропуска`,
      });
    }
  }

  if (blockers.length > 0) {
    return NextResponse.json(
      {
        error: "Завершить нельзя: есть незаполненные требования",
        blockers,
      },
      { status: 400 }
    );
  }

  await updateDiagnosticSummaryCounts(id);
  await regenerateOffersForDiagnostic(id);

  await prisma.diagnostic.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  const updated = await prisma.diagnostic.findUnique({ where: { id } });
  return NextResponse.json(updated);
}
