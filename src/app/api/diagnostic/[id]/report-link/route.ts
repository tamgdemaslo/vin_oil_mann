import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { buildDiagnosticReportUrl } from "@/lib/diagnostic-report-link";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const row = await prisma.diagnostic.findUnique({
    where: { id },
    select: { clientReportToken: true },
  });
  if (!row) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  return NextResponse.json({
    reportUrl: buildDiagnosticReportUrl(request, row.clientReportToken),
    token: row.clientReportToken,
  });
}
