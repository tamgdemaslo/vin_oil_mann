import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import type { VehicleHints } from "@/data/diagnostic-catalog";
import { seedDiagnosticPositionsIfEmpty } from "@/lib/diagnostic-seed-positions";

export async function POST(request: NextRequest) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  let body: {
    shipmentMoySkladId?: string | null;
    shipmentDraftId?: string | null;
    agentMoySkladId?: string | null;
    vin?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    licensePlate?: string | null;
    mileage?: number | null;
    vehicleHints?: VehicleHints | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const diagnostic = await prisma.diagnostic.create({
    data: {
      shipmentMoySkladId: body.shipmentMoySkladId?.trim() || null,
      shipmentDraftId: body.shipmentDraftId?.trim() || null,
      agentMoySkladId: body.agentMoySkladId?.trim() || null,
      vin: body.vin?.trim() || null,
      brand: body.brand?.trim() || null,
      model: body.model?.trim() || null,
      year: typeof body.year === "number" ? body.year : null,
      licensePlate: body.licensePlate?.trim() || null,
      mileage: typeof body.mileage === "number" ? body.mileage : null,
      mechanicLogin: gate.session.user.login,
      status: "IN_PROGRESS",
    },
  });

  await seedDiagnosticPositionsIfEmpty(diagnostic.id, body.vehicleHints ?? undefined);

  return NextResponse.json({ diagnosticId: diagnostic.id });
}
