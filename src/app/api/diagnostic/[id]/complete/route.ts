import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import {
  regenerateOffersForDiagnostic,
  updateDiagnosticSummaryCounts,
} from "@/lib/diagnostic-regenerate-offers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const diag = await prisma.diagnostic.findUnique({ where: { id } });
  if (!diag) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const positions = await prisma.diagnosticPosition.findMany({
    where: { diagnosticId: id },
    include: { photos: true },
  });
  for (const p of positions) {
    if ((p.status === "YELLOW" || p.status === "RED") && p.photos.length < 1) {
      return NextResponse.json(
        {
          error:
            "Завершить нельзя: для жёлтых/красных позиций нужно хотя бы одно фото. Проверьте узлы в модалке.",
        },
        { status: 400 }
      );
    }
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
