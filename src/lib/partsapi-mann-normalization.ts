import { normalizeEngineCode, normalizeVehicleMake } from "@/lib/vehicle-normalization";

export function partsApiCatalogMonth(value: unknown): string | undefined {
  const text = String(value ?? "");
  return /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])$/.test(text) ? `${text.slice(0,4)}-${text.slice(4)}` : undefined;
}

/** Manufacturer execution identifiers must come from a modification label,
 * never from arbitrary engine numbers, power figures, or the VIN serial. */
export function normalizeModificationLabel(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(/\([^)]*\)/g, " ")
    .replace(/KOMPRESSOR/g, "K").replace(/[^\p{L}\p{N}]/gu, "");
}

export function manufacturerTypeCodes(value: unknown): string[] {
  return [...new Set(Array.from(String(value ?? "").matchAll(/\b(\d{3})\.(\d{3})\b/g), match => `${match[1]}.${match[2]}`))];
}

const positive = (value: unknown) => {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : undefined;
};
const text = (value: unknown) => typeof value === "string" ? value.trim() || undefined : undefined;
const scalar = (from: unknown, to: unknown) => {
  const low = positive(from), high = positive(to);
  return low && high && low !== high ? undefined : low ?? high;
};

export function normalizePartsApiMannCard(card: Record<string, unknown>, requestedVin: string) {
  const make = text(card.manuName), model = text(card.modelName);
  const returnedVin = text(card.vin ?? card.VIN)?.toUpperCase();
  const rawCodes = (Array.isArray(card.motorCodes) ? card.motorCodes : [card.motorCodes])
    .filter((value): value is string => typeof value === "string")
    .map(normalizeEngineCode).filter((code): code is string => Boolean(code));
  const codes = [...new Map(rawCodes.map(code => [code.replace(/[^A-Z0-9]/g, ""), code])).values()];
  const cc = positive(card.cylinderCapacityCcm) ?? positive(card.ccmTech);
  const from = partsApiCatalogMonth(card.yearOfConstrFrom), to = partsApiCatalogMonth(card.yearOfConstrTo);
  const drive = text(card.impulsionType);
  const normalizedDrive = drive && (/полни|полн|все кол[её]са|\b(AWD|4WD|4X4|QUATTRO|XDRIVE|4MOTION)\b/i.test(drive) ? "AWD"
    : /передн|\bFWD\b/i.test(drive) ? "FWD" : /задн|\bRWD\b/i.test(drive) ? "RWD" : drive);
  return {
    valid: Boolean(make && model && normalizeVehicleMake(make)),
    vinMatches: !returnedVin || returnedVin === requestedVin,
    requestedVin, returnedVin,
    vehicle: {
      make, model, Modification: text(card.typeName), ManufacturerTypeCodes: manufacturerTypeCodes(card.typeName),
      // These are catalogue applicability bounds, not this vehicle's build date.
      ModelYearFrom: from ? Number(from.slice(0,4)) : /^(19|20)\d{2}$/.test(String(card.yearOfConstrFrom)) ? Number(card.yearOfConstrFrom) : undefined,
      ModelYearTo: to ? Number(to.slice(0,4)) : /^(19|20)\d{2}$/.test(String(card.yearOfConstrTo)) ? Number(card.yearOfConstrTo) : undefined,
      CatalogMonthFrom: from, CatalogMonthTo: to,
      EngineCode: codes.length === 1 ? codes[0] : undefined, EngineCodes: codes,
      EngineVolumeCc: cc, EngineVolumeLiters: cc ? undefined : positive(card.cylinderCapacityLiter),
      PowerKw: scalar(card.powerKwFrom, card.powerKwTo), PowerHp: scalar(card.powerHpFrom, card.powerHpTo),
      FuelType: text(card.fuelType), DriveType: normalizedDrive, BodyType: text(card.bodyStyle),
    },
  };
}
