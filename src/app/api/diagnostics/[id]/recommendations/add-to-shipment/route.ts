import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { addDiagnosticRecommendationToShipment } from "@/lib/diagnostic-map-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const position = await addDiagnosticRecommendationToShipment(id, String(body.itemCode ?? ""));
    return NextResponse.json({ ok: true, positionId: position.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось добавить в отгрузку" }, { status: 400 });
  }
}
