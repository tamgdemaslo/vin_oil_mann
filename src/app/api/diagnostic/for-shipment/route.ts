import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";

/** Найти диагностику по id отгрузки МойСклад (последняя по времени). */
export async function GET(request: NextRequest) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const shipmentId = request.nextUrl.searchParams.get("shipmentId")?.trim();
  if (!shipmentId) {
    return NextResponse.json({ error: "Укажите shipmentId" }, { status: 400 });
  }

  const row = await prisma.diagnostic.findFirst({
    where: { shipmentMoySkladId: shipmentId },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      summaryGreen: true,
      summaryYellow: true,
      summaryRed: true,
      startedAt: true,
      completedAt: true,
    },
  });

  return NextResponse.json({ diagnostic: row });
}
