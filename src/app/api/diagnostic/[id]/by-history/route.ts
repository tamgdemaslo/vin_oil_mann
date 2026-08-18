import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const diag = await prisma.diagnostic.findUnique({
    where: { id },
    select: { vin: true, shipmentDraftId: true },
  });
  if (!diag) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const demands = diag.shipmentDraftId
    ? await prisma.localDemand.findMany({
        where: { id: diag.shipmentDraftId },
        orderBy: { momentAt: "desc" },
        take: 3,
        select: {
          id: true,
          name: true,
          momentAt: true,
          sumCents: true,
          agentNameSnapshot: true,
        },
      })
    : [];

  const diagOr: { vin?: string }[] = [];
  if (diag.vin) diagOr.push({ vin: diag.vin });

  const diagnostics =
    diagOr.length > 0
      ? await prisma.diagnostic.findMany({
          where: {
            AND: [{ id: { not: id } }, { OR: diagOr }],
          },
          orderBy: { startedAt: "desc" },
          take: 2,
          select: {
            id: true,
            startedAt: true,
            summaryGreen: true,
            summaryYellow: true,
            summaryRed: true,
            vin: true,
          },
        })
      : [];

  return NextResponse.json({
    demands,
    diagnostics,
  });
}
