import { NextRequest, NextResponse } from "next/server";
import type { DiagnosticBlock, DiagnosticPositionStatus } from "@prisma/client";
import { tagLabelsForNode } from "@/data/diagnostic-catalog";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { mimeFromDiagnosticPhotoPath } from "@/lib/diagnostic-photos";
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
    block?: DiagnosticBlock;
    node: string;
    status?: DiagnosticPositionStatus;
    tags?: string[];
    measurementValue?: number | null;
    measurementUnit?: string | null;
    recommendation?: string | null;
    notes?: string | null;
    skippedReason?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const node = (body.node ?? "").trim();
  if (!node) {
    return NextResponse.json({ error: "Укажите node" }, { status: 400 });
  }

  const existing = await prisma.diagnosticPosition.findUnique({
    where: { diagnosticId_node: { diagnosticId, node } },
    include: { photos: true },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Позиция не активна для этого автомобиля. Сначала добавьте её через параметры автомобиля." },
      { status: 404 }
    );
  }

  const status = body.status ?? existing.status;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : existing.tags;
  const notes =
    body.notes !== undefined
      ? body.notes?.trim() || null
      : body.skippedReason !== undefined
        ? body.skippedReason?.trim() || null
        : existing.notes;

  const position = await prisma.diagnosticPosition.update({
    where: { id: existing.id },
    data: {
      block: body.block ?? existing.block,
      status,
      tags,
      measurementValue:
        body.measurementValue === undefined
          ? existing.measurementValue
          : body.measurementValue != null && Number.isFinite(body.measurementValue)
            ? body.measurementValue
            : null,
      measurementUnit:
        body.measurementUnit === undefined ? existing.measurementUnit : body.measurementUnit?.trim() || null,
      recommendation:
        body.recommendation === undefined ? existing.recommendation : body.recommendation?.trim() || null,
      notes,
    },
    include: { photos: true },
  });

  await updateDiagnosticSummaryCounts(diagnosticId);

  return NextResponse.json({
    ...position,
    skippedReason: position.status === "SKIPPED" ? position.notes : null,
    tagLabels: tagLabelsForNode(position.node, position.tags),
    photos: position.photos.map((photo) => ({
      ...photo,
      thumbnailUrl: `/api/diagnostic/${diagnosticId}/photo/${photo.id}`,
      url: `/api/diagnostic/${diagnosticId}/photo/${photo.id}`,
      mimeType: mimeFromDiagnosticPhotoPath(photo.filePath),
    })),
  });
}
