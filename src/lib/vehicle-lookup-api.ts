import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/api-session-cash-shift";

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
  // Lookup only reads a provider and the local MANN catalogue. A working shift
  // is required when changing a shipment, but not when identifying a vehicle.
  return requireApiSession();
}

export function vehicleLookupError(error: unknown) {
  console.error("[vehicle-lookup] unexpected error", error);
  return NextResponse.json({ error: "Сервис определения автомобиля временно недоступен. Повторите попытку позже." }, { status: 500 });
}
