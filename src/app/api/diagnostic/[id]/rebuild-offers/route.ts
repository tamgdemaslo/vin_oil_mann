import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { regenerateOffersForDiagnostic } from "@/lib/diagnostic-regenerate-offers";

/** Пересчитать офферы по текущим позициям (вызывать перед экраном Summary). */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const exists = await prisma.diagnostic.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  await regenerateOffersForDiagnostic(id);

  const offers = await prisma.diagnosticOffer.findMany({
    where: { diagnosticId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ offers });
}
