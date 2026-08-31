import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { withDiagnosticBranchRoute } from "@/lib/diagnostic-api-context";
import { addDiagnosticRecommendationToShipment } from "@/lib/diagnostic-map-service";

export const POST = withDiagnosticBranchRoute(async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const position = await addDiagnosticRecommendationToShipment(id, String(body.itemCode ?? ""));
    return NextResponse.json({ ok: true, positionId: position.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось добавить в отгрузку" }, { status: 400 });
  }
});
