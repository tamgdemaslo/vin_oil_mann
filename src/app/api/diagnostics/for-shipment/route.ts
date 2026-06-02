import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { findDiagnosticMapForShipment, requestOrigin } from "@/lib/diagnostic-map-service";

export async function GET(request: NextRequest) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;

  const shipmentId = request.nextUrl.searchParams.get("shipmentId")?.trim();
  if (!shipmentId) return NextResponse.json({ error: "shipmentId не указан" }, { status: 400 });

  const diagnostic = await findDiagnosticMapForShipment(shipmentId);
  if (!diagnostic) return NextResponse.json({ diagnostic: null });

  const origin = requestOrigin(request);
  return NextResponse.json({
    diagnostic: origin ? { ...diagnostic, reportUrl: `${origin.replace(/\/$/, "")}/report/${diagnostic.publicToken}` } : diagnostic,
  });
}
