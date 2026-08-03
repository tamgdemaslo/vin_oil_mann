import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";

export const lookupBodySchema = z.object({
  organizationId: z.string().trim().min(1).max(128).optional(),
  refresh: z.boolean().optional(),
  vin: z.string().trim().min(1).max(64).optional(),
  plate: z.string().trim().min(1).max(32).optional(),
  frame: z.string().trim().min(1).max(64).optional(),
});

export async function requireVehicleLookupRequest(request: Request, organizationId?: string) {
  void request;
  void organizationId;
  const access = await requireApiSessionWithShift();
  if (!access.ok) return access;
  return access;
}

export function vehicleLookupError(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось выполнить поиск автомобиля" }, { status: 500 });
}
