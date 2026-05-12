import { NextRequest, NextResponse } from "next/server";
import type { DiagnosticBlock, DiagnosticPositionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { updateDiagnosticSummaryCounts } from "@/lib/diagnostic-regenerate-offers";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id: diagnosticId } = await params;
  if (!diagnosticId) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: {
    block: DiagnosticBlock;
    node: string;
    status: DiagnosticPositionStatus;
    tags?: string[];
    measurementValue?: number | null;
    measurementUnit?: string | null;
    recommendation?: string | null;
    notes?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const node = (body.node ?? "").trim();
  if (!node || !body.block) {
    return NextResponse.json({ error: "Укажите block и node" }, { status: 400 });
  }

  const status = body.status;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [];

  const position = await prisma.diagnosticPosition.upsert({
    where: { diagnosticId_node: { diagnosticId, node } },
    create: {
      diagnosticId,
      block: body.block,
      node,
      status,
      tags,
      measurementValue:
        body.measurementValue != null && Number.isFinite(body.measurementValue)
          ? body.measurementValue
          : null,
      measurementUnit: body.measurementUnit?.trim() || null,
      recommendation: body.recommendation?.trim() || null,
      notes: body.notes?.trim() || null,
    },
    update: {
      status,
      tags,
      measurementValue:
        body.measurementValue != null && Number.isFinite(body.measurementValue)
          ? body.measurementValue
          : null,
      measurementUnit: body.measurementUnit?.trim() || null,
      recommendation: body.recommendation?.trim() || null,
      notes: body.notes?.trim() || null,
    },
    include: { photos: true },
  });

  await updateDiagnosticSummaryCounts(diagnosticId);

  return NextResponse.json(position);
}
