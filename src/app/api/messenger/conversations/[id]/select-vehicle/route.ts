import { NextResponse } from "next/server";
import { selectConversationVehicle } from "@/lib/messenger/messenger-context";
import { messengerContextError, readJson, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const { id } = await params;
  try {
    const body = await readJson<{ vehicle?: { id?: string; label?: string; plate?: string; vin?: string; year?: string }; expectedUpdatedAt?: string | null }>(request);
    if (!body.vehicle?.id || !body.vehicle.label) return NextResponse.json({ error: "Укажите автомобиль" }, { status: 400 });
    return NextResponse.json({
      context: await selectConversationVehicle(id, {
        vehicle: {
          id: body.vehicle.id,
          label: body.vehicle.label,
          plate: body.vehicle.plate ?? "",
          vin: body.vehicle.vin ?? "",
          year: body.vehicle.year ?? null,
        },
        expectedUpdatedAt: body.expectedUpdatedAt,
      }, access.actor),
    });
  } catch (error) {
    return messengerContextError(error);
  }
}

