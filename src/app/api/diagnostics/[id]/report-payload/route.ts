import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { withDiagnosticBranchRoute } from "@/lib/diagnostic-api-context";
import { getDiagnosticMapSession, requestOrigin } from "@/lib/diagnostic-map-service";

export const GET = withDiagnosticBranchRoute(async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const diagnostic = await getDiagnosticMapSession(id, requestOrigin(request));
  if (!diagnostic) return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });
  return NextResponse.json({ diagnostic });
});
