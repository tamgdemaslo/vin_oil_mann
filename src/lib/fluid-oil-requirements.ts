import { prisma } from "@/lib/db";
import {
  normalizeACEA,
  normalizeAPI,
  normalizeILSAC,
  normalizeOEM,
  normalizeSAE,
} from "@/lib/oil-normalizer";
import { normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-identity";
import type { OilRequirements, VinDecodeResponse } from "@/types/oil";

const ENGINE_OIL_SYSTEM_CODE = "ENGINE_OIL";
const MAX_CATALOG_CANDIDATES = 250;

type CatalogOilRequirement = {
  id: string;
  sourceUrl: string;
  makeNormalized: string;
  modelNormalized: string;
  yearFrom: number | null;
  yearTo: number | null;
  engineCodesJson: unknown;
  engineVolumeCc: number | null;
  powerHp: number | null;
  fillVolumeText: string | null;
  serviceVolumeLiters: number | null;
  fillVolumeMaxLiters: number | null;
  specificationsJson: unknown;
  viscosityGradesJson: unknown;
  contextConfidence: string;
};

export type FluidCatalogVehicle = Pick<
  VinDecodeResponse,
  "make" | "model" | "year" | "engine" | "engineCode" | "engineVolumeCc" | "powerHp"
>;

export type FluidCatalogOilMatch = {
  requirement: CatalogOilRequirement;
  score: number;
  matchedBy: string[];
};

type CatalogSpecification = { type?: unknown; value?: unknown };

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function jsonStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeCatalogMake(value: string | undefined): string | null {
  const normalized = normalizeVehicleMake(value);
  if (!normalized) return null;
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogModel(value: string | undefined, make: string | null): string | null {
  const model = normalizeVehicleModel(value, make ?? undefined).canonical;
  if (!model) return null;
  let normalized = model
    .replace(/\b(?:VIII|VII|VI|IV|III|II|IX|V|I|X)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
  if (make === "BMW") normalized = normalized.replace(/^(\d)ER$/, "$1");
  return normalized || null;
}

function normalizeEngine(value: string | undefined | null): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function yearValue(value: string | undefined): number | null {
  const year = Number(String(value ?? "").match(/(?:19|20)\d{2}/)?.[0]);
  return Number.isInteger(year) && year >= 1886 && year <= 2100 ? year : null;
}

function engineMatchScore(input: string, candidate: string): number {
  if (!input || !candidate) return 0;
  if (input === candidate) return 70;
  if (input.length >= 5 && candidate.length >= 5 && (input.startsWith(candidate) || candidate.startsWith(input))) return 55;
  return 0;
}

function requirementProfile(row: CatalogOilRequirement): string {
  return JSON.stringify({
    specifications: row.specificationsJson,
    viscosities: row.viscosityGradesJson,
    volume: row.serviceVolumeLiters ?? row.fillVolumeMaxLiters,
  });
}

/**
 * Selects only an unambiguous engine-oil row. A make/model/year match without
 * a compatible engine is intentionally rejected when it would mix variants.
 */
export function selectFluidCatalogOilMatch(
  vehicle: FluidCatalogVehicle,
  rows: CatalogOilRequirement[],
): FluidCatalogOilMatch | null {
  const make = normalizeCatalogMake(vehicle.make);
  const model = normalizeCatalogModel(vehicle.model, make);
  if (!make || !model) return null;

  const year = yearValue(vehicle.year);
  const engineCode = normalizeEngine(vehicle.engineCode);
  const volumeCc = vehicle.engineVolumeCc && vehicle.engineVolumeCc > 0 ? vehicle.engineVolumeCc : null;
  const powerHp = vehicle.powerHp && vehicle.powerHp > 0 ? vehicle.powerHp : null;
  const matches: FluidCatalogOilMatch[] = [];

  for (const row of rows) {
    if (row.makeNormalized !== make || row.modelNormalized !== model) continue;
    const matchedBy = ["марка и модель"];
    let score = 100;

    if (year != null) {
      if ((row.yearFrom != null && year < row.yearFrom) || (row.yearTo != null && year > row.yearTo)) continue;
      score += row.yearFrom != null || row.yearTo != null ? 20 : 5;
      matchedBy.push("год выпуска");
    }

    const engineScores = jsonStrings(row.engineCodesJson).map((code) => engineMatchScore(engineCode, normalizeEngine(code)));
    const bestEngineScore = Math.max(0, ...engineScores);
    if (engineCode && engineScores.length > 0 && bestEngineScore === 0) continue;
    if (bestEngineScore > 0) {
      score += bestEngineScore;
      matchedBy.push("код двигателя");
    }

    if (volumeCc != null && row.engineVolumeCc != null) {
      const difference = Math.abs(volumeCc - row.engineVolumeCc);
      if (difference > 150) continue;
      score += difference <= 25 ? 25 : 12;
      matchedBy.push("объём двигателя");
    }

    if (powerHp != null && row.powerHp != null) {
      const difference = Math.abs(powerHp - row.powerHp);
      if (difference > 20) continue;
      score += difference <= 5 ? 15 : 8;
      matchedBy.push("мощность");
    }

    matches.push({ requirement: row, score, matchedBy });
  }

  if (!matches.length) return null;
  matches.sort((left, right) => right.score - left.score || left.requirement.id.localeCompare(right.requirement.id));
  const best = matches[0]!;

  // A confirmed engine code is sufficiently specific. Otherwise, allow only
  // rows that collapse to one identical oil-requirement profile.
  if (best.matchedBy.includes("код двигателя")) return best;
  const profiles = new Set(matches.filter((match) => match.score === best.score).map((match) => requirementProfile(match.requirement)));
  return profiles.size === 1 ? best : null;
}

function fallbackSpecification(value: string): string[] {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? [clean] : [];
}

export function oilRequirementsFromCatalogMatch(match: FluidCatalogOilMatch): OilRequirements {
  const specifications = Array.isArray(match.requirement.specificationsJson)
    ? (match.requirement.specificationsJson as CatalogSpecification[])
    : [];
  const rawViscosities = jsonStrings(match.requirement.viscosityGradesJson);
  const sae = unique([
    ...rawViscosities.flatMap(normalizeSAE),
    ...specifications.filter((item) => item.type === "SAE" && typeof item.value === "string").flatMap((item) => normalizeSAE(item.value as string)),
  ]);
  const acea = unique(specifications.filter((item) => item.type === "ACEA" && typeof item.value === "string").flatMap((item) => normalizeACEA(item.value as string)));
  const api = unique(specifications.filter((item) => item.type === "API" && typeof item.value === "string").flatMap((item) => normalizeAPI(item.value as string)));
  const ilsac = unique(specifications.filter((item) => item.type === "ILSAC" && typeof item.value === "string").flatMap((item) => normalizeILSAC(item.value as string)));
  const oem = unique(
    specifications
      .filter((item) => !["RAW", "SAE", "ACEA", "API", "ILSAC"].includes(String(item.type ?? "")) && typeof item.value === "string")
      .flatMap((item) => {
        const value = item.value as string;
        const normalized = normalizeOEM(value);
        return normalized.length ? normalized : fallbackSpecification(value);
      }),
  );
  const volume = match.requirement.serviceVolumeLiters ?? match.requirement.fillVolumeMaxLiters ?? undefined;
  const volumeNote = /с\s+фильтр/i.test(match.requirement.fillVolumeText ?? "")
    ? "с фильтром"
    : /без\s+фильтр/i.test(match.requirement.fillVolumeText ?? "")
      ? "без фильтра"
      : undefined;
  const confidence = match.matchedBy.includes("код двигателя")
    ? 0.98
    : match.matchedBy.includes("объём двигателя") || match.matchedBy.includes("мощность")
      ? 0.9
      : 0.75;

  return {
    oil_capacity_liters: volume,
    oil_capacity_note: volumeNote,
    sae_viscosities: sae,
    oem_approvals: oem,
    acea,
    api,
    ilsac,
    confidence,
    source_hint: `Локальный каталог технических жидкостей: ${match.requirement.sourceUrl}; совпадение: ${match.matchedBy.join(", ")}.`,
  };
}

/** Returns local, source-linked oil requirements or null when the vehicle is ambiguous. */
export async function getOilRequirementsFromFluidCatalog(vehicle: FluidCatalogVehicle): Promise<OilRequirements | null> {
  const make = normalizeCatalogMake(vehicle.make);
  const model = normalizeCatalogModel(vehicle.model, make);
  if (!make || !model) return null;

  const year = yearValue(vehicle.year);
  try {
    const rows = await prisma.vehicleFluidRequirement.findMany({
      where: {
        systemCode: ENGINE_OIL_SYSTEM_CODE,
        makeNormalized: make,
        modelNormalized: model,
        ...(year == null
          ? {}
          : {
              AND: [
                { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
                { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
              ],
            }),
      },
      select: {
        id: true,
        sourceUrl: true,
        makeNormalized: true,
        modelNormalized: true,
        yearFrom: true,
        yearTo: true,
        engineCodesJson: true,
        engineVolumeCc: true,
        powerHp: true,
        fillVolumeText: true,
        serviceVolumeLiters: true,
        fillVolumeMaxLiters: true,
        specificationsJson: true,
        viscosityGradesJson: true,
        contextConfidence: true,
      },
      take: MAX_CATALOG_CANDIDATES,
    });
    const match = selectFluidCatalogOilMatch(vehicle, rows);
    return match ? oilRequirementsFromCatalogMatch(match) : null;
  } catch (error) {
    // The feature must gracefully fall back while older environments are still
    // awaiting the catalog migration/import.
    console.warn("[fluid-catalog] local oil requirements unavailable", error instanceof Error ? error.message : String(error));
    return null;
  }
}
