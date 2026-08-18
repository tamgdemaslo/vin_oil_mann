import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { createDiagnosticMapSession } from "@/lib/diagnostic-map-service";

export async function POST(request: NextRequest) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;

  let body: {
    shipmentId?: string | null;
    clientId?: string | null;
    clientName?: string | null;
    clientPhone?: string | null;
    vin?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: string | number | null;
    licensePlate?: string | null;
    mileage?: string | number | null;
    vehicleHints?: Record<string, unknown> | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const diagnostic = await createDiagnosticMapSession(body, auth.session.user);
  return NextResponse.json({ diagnostic, diagnosticId: diagnostic?.id });
}
