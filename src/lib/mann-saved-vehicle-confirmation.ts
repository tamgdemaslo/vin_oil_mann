import { prisma } from "@/lib/db";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-normalization";
import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import type { MannTransmissionType } from "@/lib/mann-unified-technical-profile";

export type SavedVehicleTechnicalConfirmation = {
  transmissionType?: MannTransmissionType;
  confirmedDrive?: "2WD" | "4WD";
  source: "saved_vehicle_passport";
  confirmedAt: Partial<Record<"transmissionType" | "confirmedDrive", string>>;
  conflicts: string[];
};

type Passport = Record<string, unknown>;
type DecodedContext = MannTechnicalVehicleContext & { transmissionType?: string; transmissionName?: string; driveType?: string };
const text = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim() : "";

/** Generic classes only. Never infer a gearbox model or number of gears. */
export function savedTransmissionClass(value: unknown): MannTransmissionType | undefined {
  const label = text(value).toUpperCase();
  const special = [
    /\b(?:CVT|VARIATOR)\b|ВАРИАТОР/u.test(label) ? "cvt" : undefined,
    /\b(?:DCT|DSG|ROBOT|ROBOTIC|AMT)\b|РОБОТ/u.test(label) ? "robot" : undefined,
  ].filter(Boolean) as MannTransmissionType[];
  if (special.length) return special.length === 1 ? special[0] : undefined;
  const automatic = /\b(?:AUT|AT|AUTOMATIC|AUTOMATIK)\b|АКПП|АВТОМАТ/u.test(label);
  const manual = /\b(?:MAN|MT|MANUAL|MECHANICAL|SCHALTGETRIEBE)\b|МКПП|МЕХАНИЧ/u.test(label);
  return automatic !== manual ? automatic ? "automatic" : "manual" : undefined;
}

function driveClass(value: unknown): "FWD" | "RWD" | "2WD" | "4WD" | undefined {
  const label = text(value).toUpperCase();
  const values = [
    /\b(?:FWD|FORWARD_CONTROL|FRONT[ _-]?WHEEL(?:[ _-]?DRIVE)?)\b|ПЕРЕДН/u.test(label) ? "FWD" : undefined,
    /\b(?:RWD|REAR_DRIVE|REAR[ _-]?WHEEL(?:[ _-]?DRIVE)?)\b|ЗАДН/u.test(label) ? "RWD" : undefined,
    /\b(?:4WD|AWD|4X4|ALL[ _-]?WHEEL(?:[ _-]?DRIVE)?)\b|ПОЛН/u.test(label) ? "4WD" : undefined,
  ].filter(Boolean) as ("FWD" | "RWD" | "4WD")[];
  if (values.length) return values.length === 1 && !(/\b2WD\b/u.test(label) && values[0] === "4WD") ? values[0] : undefined;
  return /\b(?:2WD|4X2)\b/u.test(label) ? "2WD" : undefined;
}

function incompatibleDrive(left: string, right: string) {
  return left !== right && !(left === "2WD" && right !== "4WD") && !(right === "2WD" && left !== "4WD");
}

function confirmedField(row: Passport, field: string): string | undefined {
  const sources = row.fieldSourcesJson as Record<string, Record<string, unknown>> | null;
  const proof = sources?.[field];
  return text(row[field]) && proof?.verificationStatus === "CONFIRMED" && proof.confidence === "HIGH"
    && text(proof.source) && typeof proof.updatedAt === "string" && Number.isFinite(Date.parse(proof.updatedAt))
    ? proof.updatedAt : undefined;
}

/** Never trust overall CONFIRMED or sourceMethods=manual as a field confirmation. */
export function selectSavedVehicleTechnicalConfirmation(input: {
  branchId: string; vin: string; vehicleContext: DecodedContext; passports: Passport[];
}): SavedVehicleTechnicalConfirmation {
  const result: SavedVehicleTechnicalConfirmation = { source: "saved_vehicle_passport", confirmedAt: {}, conflicts: [] };
  const vin = text(input.vin).toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return result;
  const context = input.vehicleContext;
  const make = normalizeVehicleMake(context.make);
  const model = make && normalizeVehicleModel(context.model, make).canonical;
  if (!make || !model) return result;
  const transmissions: { value: MannTransmissionType; at: string }[] = [];
  const drives: { value: NonNullable<ReturnType<typeof driveClass>>; at: string }[] = [];
  for (const row of input.passports) {
    if (row.branchId !== input.branchId || text(row.vin).toUpperCase() !== vin || row.status !== "ACTIVE" || row.verificationStatus !== "CONFIRMED") continue;
    const rowMake = normalizeVehicleMake(text(row.makeCanonical) || text(row.make));
    const rowModel = normalizeVehicleModel(text(row.modelCanonical) || text(row.model), rowMake).canonical;
    if (rowMake !== make || rowModel !== model) { result.conflicts.push("identity"); continue; }
    const engine = normalizeEngineCode(text(row.engineCode) || text(row.engineSeries));
    if ((typeof row.year === "number" && context.year != null && row.year !== context.year)
      || (engine && context.engineCode && engine !== normalizeEngineCode(context.engineCode))) { result.conflicts.push("identity"); continue; }
    for (const field of ["transmissionType", "transmissionName"]) {
      const at = confirmedField(row, field);
      if (!at) continue;
      const value = savedTransmissionClass(row[field]);
      if (value) transmissions.push({ value, at });
      else result.conflicts.push("transmission");
    }
    const at = confirmedField(row, "driveType");
    if (at) {
      const value = driveClass(row.driveType);
      if (value) drives.push({ value, at });
      else result.conflicts.push("drive");
    }
  }
  const decodedTypes = [context.transmissionType, context.transmissionName].map(savedTransmissionClass).filter(Boolean);
  if (new Set(transmissions.map(item => item.value)).size > 1
    || transmissions.some(item => decodedTypes.some(type => type !== item.value))) result.conflicts.push("transmission");
  const decodedDrive = driveClass(context.driveType);
  if (drives.some(item => (decodedDrive && incompatibleDrive(item.value, decodedDrive))
    || drives.some(other => incompatibleDrive(item.value, other.value)))) result.conflicts.push("drive");
  result.conflicts = [...new Set(result.conflicts)];
  if (!result.conflicts.includes("identity")) {
    if (transmissions.length && !result.conflicts.includes("transmission")) {
      result.transmissionType = transmissions[0].value;
      result.confirmedAt.transmissionType = transmissions.map(item => item.at).sort().at(-1);
    }
    if (drives.length && !result.conflicts.includes("drive")) {
      result.confirmedDrive = drives[0].value === "4WD" ? "4WD" : "2WD";
      result.confirmedAt.confirmedDrive = drives.map(item => item.at).sort().at(-1);
    }
  }
  return result;
}

export async function loadSavedVehicleTechnicalConfirmation(input: { branchId: string; vin: string; vehicleContext: DecodedContext }) {
  const vin = text(input.vin).toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) || !input.vehicleContext.make || !input.vehicleContext.model)
    return selectSavedVehicleTechnicalConfirmation({ ...input, passports: [] });
  const passports = await prisma.clientVehicle.findMany({
    where: { branchId: input.branchId, vin, status: "ACTIVE" },
    select: { branchId: true, vin: true, status: true, verificationStatus: true, make: true, makeCanonical: true,
      model: true, modelCanonical: true, year: true, engineCode: true, engineSeries: true,
      transmissionType: true, transmissionName: true, driveType: true, fieldSourcesJson: true },
  });
  return selectSavedVehicleTechnicalConfirmation({ ...input, passports });
}
