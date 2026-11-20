import { withMannEngineOilReference } from "@/lib/mann-engine-oil-reference";
import { addMannResearchCatalogToProfile } from "@/lib/mann-research-catalog";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getMannUnifiedTechnicalProfile, MANN_TRANSMISSION_TYPES } from "@/lib/mann-unified-technical-profile";
import { VEHICLE_DESTINATION_MARKETS } from "@/lib/vehicle-market";
import { mannExactEquipmentModel } from "@/lib/mann-equipment-scope";
import { researchMissingMannFluids } from "@/lib/mann-fluid-research";
import { MANN_FLUID_GROUP_IDS } from "@/lib/mann-fluid-systems";
import { loadSavedVehicleTechnicalConfirmation, type SavedVehicleTechnicalConfirmation } from "@/lib/mann-saved-vehicle-confirmation";

const bodySchema = z.object({
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/).optional(),
  decodedPowertrain: z.object({
    transmissionType: z.string().max(120).optional(),
    transmissionName: z.string().max(120).optional(),
    driveType: z.string().max(120).optional(),
  }).optional(),
  researchMissing: z.boolean().optional(),
  researchGroup: z.enum(MANN_FLUID_GROUP_IDS).optional(),
  retryFailed: z.boolean().optional(),
  variantKeys: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  transmissionType: z.enum(MANN_TRANSMISSION_TYPES).optional(),
  vehicleContext: z.object({
    rearAirConditioning: z.boolean().optional(),
    confirmedDrive: z.enum(["2WD", "4WD"]).optional(),
    make: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(160).optional(),
    generation: z.string().trim().min(1).max(80).optional(),
    engineCode: z.string().trim().min(1).max(80).optional(),
    confirmedMarket: z.enum(VEHICLE_DESTINATION_MARKETS).optional(),
    confirmedTransmissionType: z.enum(MANN_TRANSMISSION_TYPES).optional(),
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
    const loaded = await runWithBranchApiContext(branch.context, async () => {
      const { variantKeys } = parsed.data;
      let transmissionType = parsed.data.transmissionType;
      let vehicleContext = { ...parsed.data.vehicleContext };
      let savedVehicleConfirmation: SavedVehicleTechnicalConfirmation | undefined;
      let confirmationUnavailable = false;
      if (parsed.data.vin && branch.context.branchId) {
        try {
          savedVehicleConfirmation = await loadSavedVehicleTechnicalConfirmation({
            branchId: branch.context.branchId, vin: parsed.data.vin,
            vehicleContext: { ...vehicleContext, ...parsed.data.decodedPowertrain },
          });
          transmissionType ??= savedVehicleConfirmation.transmissionType;
          vehicleContext.confirmedDrive ??= savedVehicleConfirmation.confirmedDrive;
        } catch {
          confirmationUnavailable = true;
          console.warn("[mann-technical-profile] saved vehicle confirmation unavailable");
        }
      }
      vehicleContext = { ...vehicleContext, confirmedTransmissionType: transmissionType };
      const { organizationId } = branch.context;
      let profile = await getMannUnifiedTechnicalProfile(variantKeys, transmissionType, vehicleContext);
      // Establish verified fields before adding saved research, so a saved SAE-only
      // result cannot hide the known oil capacity on the next visit.
      profile = withMannEngineOilReference(profile, vehicleContext) ?? profile;
      if (organizationId) {
        try {
          profile = await addMannResearchCatalogToProfile({ organizationId, variantKeys, transmissionType, engineCode: vehicleContext.engineCode, vehicleContext, profile });
        } catch (error) {
          console.warn("[mann-technical-profile] research catalog unavailable", error instanceof Error ? error.message : String(error));
        }
      }
      profile = withMannEngineOilReference(profile, vehicleContext) ?? profile;
      if (savedVehicleConfirmation && (savedVehicleConfirmation.transmissionType || savedVehicleConfirmation.confirmedDrive || savedVehicleConfirmation.conflicts.length))
        profile = { ...profile, savedVehicleConfirmation };
      const confirmationNotice = confirmationUnavailable
        ? "Сохранённые подтверждения автомобиля недоступны. Уточните КПП и привод вручную."
        : savedVehicleConfirmation?.conflicts.length
          ? "Сохранённые подтверждения расходятся с данными автомобиля. Уточните КПП и привод."
          : undefined;
      if (confirmationNotice) profile = { ...profile, notice: [profile.notice, confirmationNotice].filter(Boolean).join(" ") };
      return { profile, transmissionType, vehicleContext };
    });
    if (parsed.data.researchMissing) {
      const organizationId = branch.context.organizationId;
      if (!organizationId) return NextResponse.json({ error: "Выберите организацию" }, { status: 403 });
      const research = await runWithBranchApiContext(branch.context, () => researchMissingMannFluids({
        organizationId, variantKeys: parsed.data.variantKeys,
        group: parsed.data.researchGroup, retryFailed: parsed.data.retryFailed,
        transmissionType: loaded.transmissionType, vehicleContext: loaded.vehicleContext, profile: loaded.profile,
      }));
      return NextResponse.json(research);
    }
    return NextResponse.json(loaded.profile);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить технический профиль" },
      { status: 500 },
    );
  }
}
