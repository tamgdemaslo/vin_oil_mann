import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Публичный отчёт без авторизации (без служебных полей мастера). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "token не указан" }, { status: 400 });

  const diag = await prisma.diagnostic.findUnique({
    where: { clientReportToken: token },
    include: {
      positions: {
        include: { photos: { select: { id: true, caption: true, createdAt: true } } },
        orderBy: [{ block: "asc" }, { node: "asc" }],
      },
    },
  });

  if (!diag) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const positions = diag.positions
    .filter((p) => p.status === "YELLOW" || p.status === "RED")
    .map((p) => ({
      id: p.id,
      block: p.block,
      node: p.node,
      status: p.status,
      tags: p.tags,
      measurementValue: p.measurementValue,
      measurementUnit: p.measurementUnit,
      recommendation: p.recommendation,
      photos: p.photos.map((ph) => ({
        id: ph.id,
        caption: ph.caption,
        url: `/api/diagnostic/public/${token}/photo/${ph.id}`,
      })),
    }));

  return NextResponse.json({
    header: {
      brand: diag.brand,
      model: diag.model,
      year: diag.year,
      licensePlate: diag.licensePlate,
      mileage: diag.mileage,
      vin: diag.vin,
      startedAt: diag.startedAt,
      completedAt: diag.completedAt,
      summaryGreen: diag.summaryGreen,
      summaryYellow: diag.summaryYellow,
      summaryRed: diag.summaryRed,
      mechanicLogin: diag.mechanicLogin ? maskLogin(diag.mechanicLogin) : null,
    },
    clientWantsReminder: diag.clientWantsReminder,
    positions,
  });
}

function maskLogin(login: string): string {
  const s = login.trim();
  if (s.length <= 2) return s;
  return `${s[0]}${"•".repeat(Math.min(4, s.length - 2))}${s[s.length - 1]}`;
}
