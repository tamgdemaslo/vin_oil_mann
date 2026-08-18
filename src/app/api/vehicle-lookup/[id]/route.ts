import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiSessionWithCashShift();
  if (!access.ok) return access.response;
  const { id } = await params;
  const item = await prisma.vehicleLookupCache.findUnique({
    where: { id },
    select: { id: true, organizationId: true, inputType: true, maskedInput: true, method: true, status: true, normalizedVehicleJson: true, requestedAt: true, completedAt: true, expiresAt: true, errorCode: true, errorMessage: true, sourceVersion: true },
  });
  if (!item) return NextResponse.json({ error: "Запрос автомобиля не найден" }, { status: 404 });
  return NextResponse.json({ lookup: item });
}
