import { NextRequest, NextResponse } from "next/server";
import { lookupVehicle } from "@/lib/vehicle-identity";
import { lookupBodySchema, requireVehicleLookupRequest, vehicleLookupError } from "@/lib/vehicle-lookup-api";

export async function POST(request: NextRequest) {
  const parsed = lookupBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.plate) return NextResponse.json({ error: "Укажите госномер" }, { status: 400 });
  const organizationId = parsed.data.organizationId ?? "default";
  const access = await requireVehicleLookupRequest(request, organizationId);
  if (!access.ok) return access.response;
  try {
    const result = await lookupVehicle({ organizationId, inputType: "plate", input: parsed.data.plate, refresh: parsed.data.refresh, actorLogin: access.session.user.login });
    return NextResponse.json(result);
  } catch (error) {
    return vehicleLookupError(error);
  }
}
