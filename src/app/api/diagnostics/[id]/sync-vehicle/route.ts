import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { getDiagnosticMapSession, requestOrigin } from "@/lib/diagnostic-map-service";
import { syncDiagnosticVehicleFromShipment, type DiagnosticVehicleSyncMode } from "@/lib/diagnostic-vehicle-sync";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: { mode?: DiagnosticVehicleSyncMode } = {};
  try {
    body = (await request.json()) as { mode?: DiagnosticVehicleSyncMode };
  } catch {
    body = {};
  }
  const mode = body.mode === "forceOverwrite" ? "forceOverwrite" : "fillMissingOnly";
  const sync = await syncDiagnosticVehicleFromShipment(id, {
    mode,
    reason: mode === "forceOverwrite" ? "manual-force" : "manual-fill-missing",
    userLogin: auth.session.user.login,
  });
  const diagnostic = await getDiagnosticMapSession(id, requestOrigin(request));
  if (!diagnostic) return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });
  return NextResponse.json({ diagnostic, sync });
}
