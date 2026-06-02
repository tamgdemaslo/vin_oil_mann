import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { getDiagnosticMapSession, requestOrigin } from "@/lib/diagnostic-map-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const diagnostic = await getDiagnosticMapSession(id, requestOrigin(request));
  if (!diagnostic) return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });

  return NextResponse.json(diagnostic);
}
