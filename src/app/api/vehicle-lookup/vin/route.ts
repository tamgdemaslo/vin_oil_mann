import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-session-cash-shift";
import { lookupVehicle, savedVinLookupDiagnostics } from "@/lib/vehicle-identity";
import { lookupBodySchema, requireVehicleLookupRequest, vehicleLookupError } from "@/lib/vehicle-lookup-api";

export async function POST(request: NextRequest) {
  const parsed = lookupBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.vin) return NextResponse.json({ error: "Укажите VIN" }, { status: 400 });
  const organizationId = parsed.data.organizationId ?? "default";
  const access = await requireVehicleLookupRequest(request, organizationId);
  if (!access.ok) return access.response;
  try {
    const result = await lookupVehicle({ organizationId, inputType: "vin", input: parsed.data.vin, refresh: parsed.data.refresh, actorLogin: access.session.user.login });
    return NextResponse.json(result);
  } catch (error) {
    return vehicleLookupError(error);
  }
}


export async function GET(request: NextRequest) {
  const access = await requireApiSession();
  if (!access.ok) return access.response;
  if (access.session.user.role !== "owner") return NextResponse.json({ error: "Доступ владельца" }, { status: 403 });
  const vin = request.nextUrl.searchParams.get("vin")?.trim().toUpperCase() ?? "";
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return NextResponse.json({ error: "Укажите VIN" }, { status: 400 });
  return NextResponse.json({ vin, savedResponses: await savedVinLookupDiagnostics(vin) }, { headers: { "Cache-Control": "no-store" } });
}
