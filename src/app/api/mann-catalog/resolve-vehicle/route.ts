import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { resolveMannVehicle } from "@/lib/mann-vehicle-resolver";
import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity";

const bodySchema = z.object({
  organizationId: z.string().trim().min(1).max(128).optional(),
  warehouseId: z.string().trim().min(1).max(128).optional(),
  vehicle: z.custom<NormalizedVehicleIdentity>((value) => Boolean(value) && typeof value === "object"),
});

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Передайте нормализованный автомобиль" }, { status: 400 });
  try {
    const result = await runWithBranchApiContext(branch.context, () =>
      resolveMannVehicle({
        organizationId: parsed.data.organizationId ?? "default",
        warehouseId: parsed.data.warehouseId,
        vehicle: parsed.data.vehicle,
      })
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сопоставить автомобиль с MANN" }, { status: 500 });
  }
}
