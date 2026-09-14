import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getMannUnifiedTechnicalProfile, MANN_TRANSMISSION_TYPES } from "@/lib/mann-unified-technical-profile";
import { VEHICLE_DESTINATION_MARKETS } from "@/lib/vehicle-market";
import { mannExactEquipmentModel } from "@/lib/mann-equipment-scope";

const bodySchema = z.object({
  variantKeys: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  transmissionType: z.enum(MANN_TRANSMISSION_TYPES).optional(),
  vehicleContext: z.object({
    make: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(160).optional(),
    generation: z.string().trim().min(1).max(80).optional(),
    engineCode: z.string().trim().min(1).max(80).optional(),
    confirmedMarket: z.enum(VEHICLE_DESTINATION_MARKETS).optional(),
    transmissionModel: z.string().trim().min(1).max(80).optional(),
    transmissionGearCount: z.number().int().min(3).max(18).optional(),
    confirmedEquipment: z.array(z.object({
      circuit: z.enum(["HYDRAULIC_STEERING", "TRANSFER_CASE", "FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL", "ANGLE_GEAR", "AWD_COUPLING"]),
      drive: z.enum(["2WD", "4WD"]).optional(),
      componentModel: z.string().max(16).refine(value => mannExactEquipmentModel(value) === value).optional(),
      attachedTransmissionType: z.enum(MANN_TRANSMISSION_TYPES).optional(),
    }).strict()).max(6).refine(items => new Set(items.map(item => item.circuit)).size === items.length, "Подтвердите каждый узел только один раз").optional(),
    productionMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    year: z.number().int().min(1886).max(2100).optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Передайте выбранную MANN-модификацию" }, { status: 400 });
  }

  try {
    const profile = await runWithBranchApiContext(branch.context, () =>
      getMannUnifiedTechnicalProfile(parsed.data.variantKeys, parsed.data.transmissionType, parsed.data.vehicleContext)
    );
    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить технический профиль" },
      { status: 500 },
    );
  }
}
