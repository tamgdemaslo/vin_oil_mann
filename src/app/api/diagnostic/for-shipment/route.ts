import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";

function isMissingDiagnosticSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "P2021" ||
    message.includes("public.diagnostics") ||
    (message.includes("relation") && message.includes("diagnostics") && message.includes("does not exist"))
  );
}

/** Найти диагностику по id отгрузки МойСклад (последняя по времени). */
export async function GET(request: NextRequest) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const shipmentId = request.nextUrl.searchParams.get("shipmentId")?.trim();
  if (!shipmentId) {
    return NextResponse.json({ error: "Укажите shipmentId" }, { status: 400 });
  }

  let row = null;
  try {
    row = await prisma.diagnostic.findFirst({
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
  } catch (error) {
    if (!isMissingDiagnosticSchemaError(error)) throw error;
    return NextResponse.json({ diagnostic: null, schemaMissing: true });
  }

  return NextResponse.json({ diagnostic: row });
}
