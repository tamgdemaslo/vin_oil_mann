import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import type { VehicleHints } from "@/data/diagnostic-catalog";
import { seedDiagnosticPositionsIfEmpty } from "@/lib/diagnostic-seed-positions";

async function loadFull(diagnosticId: string) {
  return prisma.diagnostic.findUnique({
    where: { id: diagnosticId },
    include: {
      positions: {
        include: { photos: true },
        orderBy: [{ block: "asc" }, { node: "asc" }],
      },
      offers: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  await seedDiagnosticPositionsIfEmpty(id);

  const row = await loadFull(id);
  if (!row) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  return NextResponse.json(row);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: {
    vin?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    licensePlate?: string | null;
    mileage?: number | null;
    shipmentMoySkladId?: string | null;
    agentMoySkladId?: string | null;
    vehicleHints?: VehicleHints | null;
    clientWantsReminder?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.vin !== undefined) data.vin = body.vin?.trim() || null;
  if (body.brand !== undefined) data.brand = body.brand?.trim() || null;
  if (body.model !== undefined) data.model = body.model?.trim() || null;
  if (body.year !== undefined) data.year = typeof body.year === "number" ? body.year : null;
  if (body.licensePlate !== undefined) data.licensePlate = body.licensePlate?.trim() || null;
  if (body.mileage !== undefined) data.mileage = typeof body.mileage === "number" ? body.mileage : null;
  if (body.shipmentMoySkladId !== undefined) data.shipmentMoySkladId = body.shipmentMoySkladId?.trim() || null;
  if (body.agentMoySkladId !== undefined) data.agentMoySkladId = body.agentMoySkladId?.trim() || null;
  if (typeof body.clientWantsReminder === "boolean") data.clientWantsReminder = body.clientWantsReminder;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
  }

  await prisma.diagnostic.update({
    where: { id },
    data: data as object,
  });

  if (body.vehicleHints) {
    await seedDiagnosticPositionsIfEmpty(id, body.vehicleHints);
  }

  const row = await loadFull(id);
  return NextResponse.json(row);
}
