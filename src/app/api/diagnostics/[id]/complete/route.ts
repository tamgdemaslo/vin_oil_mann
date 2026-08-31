import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { withDiagnosticBranchRoute } from "@/lib/diagnostic-api-context";
import { completeDiagnosticMapSession, requestOrigin } from "@/lib/diagnostic-map-service";

export const POST = withDiagnosticBranchRoute(async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const diagnostic = await completeDiagnosticMapSession(id);
  if (!diagnostic) return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });
  const origin = requestOrigin(request);
  return NextResponse.json(origin ? { ...diagnostic, reportUrl: `${origin.replace(/\/$/, "")}/report/${diagnostic.publicToken}` } : diagnostic);
});
