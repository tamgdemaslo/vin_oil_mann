import type { Prisma } from "@prisma/client";
import type { OilProduct, OilRecommendationItem, OilRequirements, VinDecodeResponse } from "@/types/oil";
import { prisma } from "@/lib/db";
import { getOilRequirementsFromOpenAI, scoreAndMatch } from "@/lib/oil-recommendations";
import {
  normalizeACEA,
  normalizeAPI,
  normalizeILSAC,
  normalizeOEM,
  normalizeSAE,
} from "@/lib/oil-normalizer";
import { parsePackVolumeLitersFromOilName } from "@/lib/oil-pack-volume";
import { partsCatalogsRequest } from "@/lib/parts-catalogs";
import { createOpenAIClient } from "@/lib/openai-client";
import { getOilRequirementsFromFluidCatalog } from "@/lib/fluid-oil-requirements";

export type PublicOilCard = {
  id: string;
  name: string;
  article?: string;
  brand?: string;
  sae?: string;
  acea?: string;
  apiSpec?: string;
  packageVolume?: string;
  price: number;
  currency: string;
  available: number;
  imageHref?: string;
};

export type PublicOilRecommendation = PublicOilCard & {
  score: number;
  why: string[];
};

type LocalOilRow = Awaited<ReturnType<typeof loadLocalOilRows>>[number];

type PublicOilQuery = {
  search?: string;
  brand?: string;
  sae?: string;
  acea?: string;
  api?: string;
  limit?: number;
};

type CarInfoItem = {
  title?: string;
  brand?: string;
  modelName?: string;
  make?: string;
  model?: string;
  year?: string;
  modelYear?: string;
  manufacturer?: string;
  description?: string;
  parameters?: { key?: string; name?: string; value?: string | number | null }[];
};

function mergeUnique(values: string[][]): string[] {
  return [...new Set(values.flat().map((value) => value.trim()).filter(Boolean))];
}

function decimalToNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compact(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function getProductText(row: {
  name: string;
  groupPath: string | null;
  description: string | null;
  brand: string | null;
  sae: string | null;
  acea: string | null;
  apiSpec: string | null;
  oem: string | null;
  searchText: string;
}): string {
  return [
    row.name,
    row.groupPath,
    row.description,
    row.brand,
    row.sae,
    row.acea,
    row.apiSpec,
    row.oem,
    row.searchText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function looksLikeMotorOil(row: LocalOilRow): boolean {
  const text = getProductText(row);
  const sae = normalizeSAE(row.sae ?? row.name);
  const accessorySignal =
    /фильтр|filter|кольц|пробк|клипс|герметик|замена|диагност|колод|датчик|ламп|подъемник|крышк|корпус|шайб|проклад/.test(text);
  if (accessorySignal) return false;

  const hasOilSignal =
    text.includes("масл") ||
    text.includes("oil") ||
    sae.length > 0 ||
    normalizeACEA(row.acea ?? row.name).length > 0;
  if (!hasOilSignal) return false;

  const hasMotorSignal = /мотор|двигател|engine/.test(text);
  if (!hasMotorSignal && sae.length === 0) return false;

  const hasNonMotorSignal = /трансмис|акпп|atf|gear|редуктор|гур|psf|тормозн|brake|антифриз|coolant/.test(text);
  return !hasNonMotorSignal || hasMotorSignal;
}

function motorOilCandidateWhere(): Prisma.LocalProductWhereInput {
  const textMode = "insensitive" as const;

  return {
    AND: [
      {
        OR: [
          { sae: { not: null } },
          { acea: { not: null } },
          { apiSpec: { not: null } },
          { ilsac: { not: null } },
          { name: { contains: "мотор", mode: textMode } },
          { name: { contains: "engine", mode: textMode } },
          { groupPath: { contains: "мотор", mode: textMode } },
          { groupPath: { contains: "engine", mode: textMode } },
          { searchText: { contains: "мотор", mode: textMode } },
          { searchText: { contains: "engine", mode: textMode } },
        ],
      },
      {
        NOT: {
          OR: [
            { name: { contains: "фильтр", mode: textMode } },
            { name: { contains: "filter", mode: textMode } },
            { name: { contains: "кольц", mode: textMode } },
            { name: { contains: "пробк", mode: textMode } },
            { name: { contains: "клипс", mode: textMode } },
            { name: { contains: "герметик", mode: textMode } },
            { name: { contains: "колод", mode: textMode } },
            { name: { contains: "датчик", mode: textMode } },
            { name: { contains: "ламп", mode: textMode } },
            { name: { contains: "шайб", mode: textMode } },
            { name: { contains: "проклад", mode: textMode } },
            { name: { contains: "трансмис", mode: textMode } },
            { name: { contains: "акпп", mode: textMode } },
            { name: { contains: "atf", mode: textMode } },
            { name: { contains: "gear", mode: textMode } },
            { name: { contains: "гур", mode: textMode } },
            { name: { contains: "psf", mode: textMode } },
            { name: { contains: "тормозн", mode: textMode } },
            { name: { contains: "brake", mode: textMode } },
            { name: { contains: "антифриз", mode: textMode } },
            { name: { contains: "coolant", mode: textMode } },
          ],
        },
      },
    ],
  };
}

function totalAvailable(row: LocalOilRow): number {
  return row.stockBalances.reduce((sum, balance) => sum + decimalToNumber(balance.available), 0);
}

function toPublicOilCard(row: LocalOilRow): PublicOilCard {
  // Internal product photos are operational attachments, not curated storefront assets.
  // Keep imageHref absent until the catalog has an explicitly approved public image.
  return {
    id: row.id,
    name: row.name,
    article: row.article ?? undefined,
    brand: row.brand ?? undefined,
    sae: row.sae ?? undefined,
    acea: row.acea ?? undefined,
    apiSpec: row.apiSpec ?? undefined,
    packageVolume: row.packageVolume ?? undefined,
    price: row.salePriceCents / 100,
    currency: row.currencyName ?? "руб.",
    available: totalAvailable(row),
  };
}

function toOilProduct(row: LocalOilRow): OilProduct {
  const volume =
    row.packageVolume != null
      ? Number.parseFloat(row.packageVolume.replace(",", ".").replace(/[^\d.]/g, ""))
      : Number.NaN;
  const volumeLiters = Number.isFinite(volume) ? volume : parsePackVolumeLitersFromOilName(row.name) ?? undefined;

  return {
    id: row.id,
    name: row.name,
    article: row.article ?? undefined,
    price: row.salePriceCents / 100,
    currency: row.currencyName ?? "руб.",
    meta: { href: `local://product/${row.id}` },
    requirements_norm: {
      sae: mergeUnique([normalizeSAE(row.sae ?? ""), normalizeSAE(row.name)]),
      oem: mergeUnique([normalizeOEM(row.oem ?? ""), normalizeOEM(row.name)]),
      acea: mergeUnique([normalizeACEA(row.acea ?? ""), normalizeACEA(row.aceaExtra ?? ""), normalizeACEA(row.name)]),
      api: mergeUnique([normalizeAPI(row.apiSpec ?? ""), normalizeAPI(row.name)]),
      ilsac: mergeUnique([normalizeILSAC(row.ilsac ?? ""), normalizeILSAC(row.name)]),
    },
    volume_liters: volumeLiters,
    imageHref: row.imageHref ?? undefined,
  };
}

async function loadLocalOilRows(params: PublicOilQuery = {}, scanLimit = 1000) {
  const search = compact(params.search);
  const brand = compact(params.brand);
  const sae = compact(params.sae);
  const acea = compact(params.acea);
  const api = compact(params.api);
  const and: Prisma.LocalProductWhereInput[] = [];

  and.push(motorOilCandidateWhere());

  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { article: { contains: search, mode: "insensitive" as const } },
        { brand: { contains: search, mode: "insensitive" as const } },
        { searchText: { contains: search.toLowerCase(), mode: "insensitive" as const } },
      ],
    });
  }
  if (brand) and.push({ brand: { contains: brand, mode: "insensitive" as const } });
  if (sae) and.push({ OR: [{ sae: { contains: sae, mode: "insensitive" as const } }, { name: { contains: sae, mode: "insensitive" as const } }] });
  if (acea) and.push({ OR: [{ acea: { contains: acea, mode: "insensitive" as const } }, { name: { contains: acea, mode: "insensitive" as const } }] });
  if (api) and.push({ OR: [{ apiSpec: { contains: api, mode: "insensitive" as const } }, { name: { contains: api, mode: "insensitive" as const } }] });

  return prisma.localProduct.findMany({
    where: {
      archived: false,
      entityType: { not: "service" },
      ...(and.length > 0 ? { AND: and } : {}),
    },
    include: {
      stockBalances: true,
    },
    orderBy: [{ name: "asc" }],
    take: scanLimit,
  });
}

async function loadPublicOilMatches(params: PublicOilQuery = {}, scanLimit = 1000) {
  const rows = await loadLocalOilRows(params, scanLimit);
  return rows
    .filter(looksLikeMotorOil)
    .map((row) => ({
      card: toPublicOilCard(row),
      product: toOilProduct(row),
    }));
}

export async function listPublicOils(params: PublicOilQuery) {
  const limit = Math.min(1000, Math.max(1, params.limit ?? 30));
  const matches = await loadPublicOilMatches(params, Math.min(2500, Math.max(200, limit * 3)));
  const oils = matches
    .map((item) => item.card)
    .sort((a, b) => {
      const stockOrder = Number(b.available > 0) - Number(a.available > 0);
      if (stockOrder !== 0) return stockOrder;
      if (b.available !== a.available) return b.available - a.available;
      return a.name.localeCompare(b.name, "ru");
    })
    .slice(0, limit);

  return { count: oils.length, oils };
}

function getCarInfoItems(carData: unknown): CarInfoItem[] {
  if (Array.isArray(carData)) return carData as CarInfoItem[];
  if (!carData || typeof carData !== "object") return [];
  const data = carData as Record<string, unknown>;
  for (const key of ["items", "rows", "data", "cars", "results"]) {
    const value = data[key];
    if (Array.isArray(value)) return value as CarInfoItem[];
  }
  return [data as CarInfoItem];
}

function paramsMap(first: CarInfoItem): Map<string, string> {
  const params = new Map<string, string>();
  for (const param of first.parameters ?? []) {
    const value = param.value == null ? "" : String(param.value).trim();
    if (!value) continue;
    const key = (param.key ?? "").trim().toLowerCase();
    const name = (param.name ?? "").trim().toLowerCase();
    if (key) params.set(key, value);
    if (name) params.set(name, value);
  }
  return params;
}

function firstParameter(params: Map<string, string>, pattern: RegExp): string | undefined {
  for (const [key, value] of params) {
    if (pattern.test(key)) return value;
  }
  return undefined;
}

function cubicCentimeters(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value.replace(",", ".").match(/\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return number < 20 ? Math.round(number * 1000) : Math.round(number);
}

async function decodeVinForPublic(
  vin: string,
  vehicleOverrides?: { displacementL?: string; enginePowerPS?: number }
): Promise<VinDecodeResponse | null> {
  const { status, data } = await partsCatalogsRequest("/car/info", { q: vin });
  if (status !== 200 || !data) return null;
  const first = getCarInfoItems(data)[0];
  if (!first) return null;

  const params = paramsMap(first);
  const title = compact(first.title);
  const description = compact(first.description);
  const yearFromProduction =
    compact(params.get("production date")).match(/\b(19|20)\d{2}\b/)?.[0] ??
    compact(params.get("production period")).match(/\b(19|20)\d{2}\b/)?.[0] ??
    "";
  const engineFromDescription =
    description.match(/\bEngine(?:\s+\w+)?:\s*([^.;\r\n]+)/i)?.[1]?.trim() ??
    description.match(/\b([A-ZА-Я0-9]{2,8})\s+engine\b/i)?.[1]?.trim() ??
    "";
  const hints = [
    vehicleOverrides?.displacementL ? `Объем двигателя: ${vehicleOverrides.displacementL} л` : "",
    typeof vehicleOverrides?.enginePowerPS === "number" && Number.isFinite(vehicleOverrides?.enginePowerPS)
      ? `Мощность: ${vehicleOverrides.enginePowerPS} л.с.`
      : "",
  ].filter(Boolean);

  const make = compact(first.brand) || compact(first.make) || compact(first.manufacturer) || title.split(/\s+/)[0] || undefined;
  const model = compact(first.modelName) || compact(first.model) || title.split(/\s+/).slice(1).join(" ") || undefined;
  const overrideVolumeCc = cubicCentimeters(vehicleOverrides?.displacementL);
  const engineCode =
    compact(params.get("engine code")) ||
    compact(params.get("код двигателя")) ||
    compact(params.get("engine_code")) ||
    undefined;

  return {
    vin,
    make,
    model,
    year: compact(first.modelYear) || compact(first.year) || compact(params.get("year")) || yearFromProduction || undefined,
    engine:
      compact(params.get("engine")) ||
      compact(params.get("spec_engine")) ||
      compact(params.get("engine code")) ||
      engineFromDescription ||
      undefined,
    engineCode,
    engineVolumeCc: overrideVolumeCc ?? cubicCentimeters(firstParameter(params, /engine.*(?:volume|capacity)|объ[её]м.*двигател/i)),
    powerHp: vehicleOverrides?.enginePowerPS ?? cubicCentimeters(firstParameter(params, /power|мощност|л\.?с/i)),
    trim: compact(params.get("car_name")) || title || undefined,
    series: compact(params.get("spec_series")) || compact(params.get("series")) || undefined,
    market: compact(params.get("sales_region")) || compact(params.get("region")) || undefined,
    region: compact(params.get("region")) || undefined,
    hints,
  };
}

function hasSearchableRequirements(requirements: OilRequirements | null): requirements is OilRequirements {
  if (!requirements) return false;
  return Boolean(
    requirements.sae_viscosities.length ||
      requirements.oem_approvals.length ||
      requirements.acea.length ||
      requirements.api.length ||
      (requirements.ilsac?.length ?? 0)
  );
}

function publicVehicle(decoded: VinDecodeResponse | null) {
  if (!decoded) return null;
  return {
    make: decoded.make,
    model: decoded.model,
    year: decoded.year,
    engine: decoded.engine,
    trim: decoded.trim,
    series: decoded.series,
    market: decoded.market,
    region: decoded.region,
  };
}

function sanitizeRecommendation(
  item: OilRecommendationItem,
  cardsById: Map<string, PublicOilCard>
): PublicOilRecommendation | null {
  const card = cardsById.get(item.product.id);
  if (!card) return null;
  return {
    ...card,
    score: item.score,
    why: item.why,
  };
}

export function normalizePublicVin(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s/g, "").toUpperCase().replace(/-/g, "") : "";
}

export async function getPublicVinOilRecommendation(params: {
  vin: string;
  vehicleOverrides?: { displacementL?: string; enginePowerPS?: number };
}) {
  const decoded = await decodeVinForPublic(params.vin, params.vehicleOverrides);
  let requirements: OilRequirements | null = null;
  let warning: string | undefined;

  if (decoded) requirements = await getOilRequirementsFromFluidCatalog(decoded);
  if (!requirements) {
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (openaiKey && decoded && (decoded.make || decoded.model || decoded.year || (decoded.hints?.length ?? 0) > 0)) {
      try {
        requirements = await getOilRequirementsFromOpenAI(createOpenAIClient(openaiKey), decoded);
      } catch (error) {
        console.error("[public/vin-oil] oil requirements failed", error);
        warning = "Не удалось уточнить требования масла. Проверьте VIN или повторите запрос позже.";
      }
    } else if (!decoded) {
      warning = "Не удалось распознать автомобиль по VIN.";
    } else {
      warning = "Не найдено однозначного требования в каталоге, а резервный подбор временно недоступен.";
    }
  }

  if (!hasSearchableRequirements(requirements)) {
    return {
      vin: params.vin,
      vehicle: publicVehicle(decoded),
      requirements,
      recommended: [],
      alternatives: [],
      warning: warning ?? "Не удалось определить требования к маслу по этому VIN.",
    };
  }

  const localOils = await loadPublicOilMatches({}, 1500);
  const cardsById = new Map(localOils.map((item) => [item.product.id, item.card]));
  const { recommended, alternatives } = scoreAndMatch(
    requirements,
    localOils.map((item) => item.product),
    10,
    10
  );
  const publicRecommended = recommended
    .map((item) => sanitizeRecommendation(item, cardsById))
    .filter((item): item is PublicOilRecommendation => Boolean(item));
  const publicAlternatives = alternatives
    .map((item) => sanitizeRecommendation(item, cardsById))
    .filter((item): item is PublicOilRecommendation => Boolean(item));

  return {
    vin: params.vin,
    vehicle: publicVehicle(decoded),
    requirements,
    recommended: publicRecommended,
    alternatives: publicAlternatives,
    warning:
      warning ??
      (publicRecommended.length === 0
        ? "Требования определены, но подходящих моторных масел в локальной базе не найдено."
        : undefined),
  };
}
