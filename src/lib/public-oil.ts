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
import { resolvePublicStorefront, type PublicStorefrontContext } from "@/lib/public-storefront";

export type PublicOilAvailability = "IN_STOCK" | "OUT_OF_STOCK" | "NOT_LISTED" | "UNKNOWN";

export type PublicOilOffer = {
  branchId: string;
  name: string;
  address: string | null;
  phone: string | null;
  availability: PublicOilAvailability;
  available: number | null;
  uom: string | null;
  price: number | null;
  currency: string;
  asOf: string | null;
};

export type PublicOilCard = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  article?: string;
  brand?: string;
  sae?: string;
  acea?: string;
  apiSpec?: string;
  ilsac?: string;
  oem?: string;
  packageVolume?: string;
  uom?: string;
  price: number | null;
  currency: string;
  available: number;
  pricesDiffer: boolean;
  offers: PublicOilOffer[];
  updatedAt: string;
  imageHref?: string;
};

export type PublicOilRecommendation = PublicOilCard & {
  score: number;
  why: string[];
};

const STOREFRONT_OIL_ROW_SELECT = {
  id: true,
  slug: true,
  publicName: true,
  publicDescription: true,
  publicImageHref: true,
  updatedAt: true,
  contentSource: {
    select: {
      name: true,
      description: true,
      article: true,
      brand: true,
      sae: true,
      acea: true,
      aceaExtra: true,
      apiSpec: true,
      ilsac: true,
      oem: true,
      packageVolume: true,
      uomName: true,
      currencyName: true,
      salePriceCents: true,
    },
  },
  bindings: {
    where: { status: "CONFIRMED" },
    select: {
      branchId: true,
      localProduct: {
        select: {
          archived: true,
          uomName: true,
          salePriceCents: true,
          currencyName: true,
          updatedAt: true,
          stockBalances: {
            select: { storeId: true, available: true, syncedAt: true },
          },
        },
      },
    },
  },
} satisfies Prisma.StorefrontProductSelect;

type StorefrontOilRow = Prisma.StorefrontProductGetPayload<{
  select: typeof STOREFRONT_OIL_ROW_SELECT;
}>;

type PublicOilQuery = {
  search?: string;
  brand?: string;
  sae?: string;
  acea?: string;
  api?: string;
  limit?: number;
  offset?: number;
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

function configuredBranchName(configured: PublicStorefrontContext["branches"][number]) {
  return configured.publicName?.trim() || configured.branch.shortName || configured.branch.name;
}

function toPublicOffer(
  row: StorefrontOilRow,
  configured: PublicStorefrontContext["branches"][number]
): PublicOilOffer {
  const binding = row.bindings.find((item) => item.branchId === configured.branchId);
  const localProduct = binding?.localProduct;
  if (!localProduct || localProduct.archived) {
    return {
      branchId: configured.id,
      name: configuredBranchName(configured),
      address: configured.publicAddress?.trim() || configured.branch.address || null,
      phone: configured.publicPhone?.trim() || configured.branch.phone || null,
      availability: "NOT_LISTED",
      available: null,
      uom: null,
      price: null,
      currency: "руб.",
      asOf: null,
    };
  }
  const allowedStoreIds = new Set(configured.stores.map((item) => item.storeId));
  const balances = localProduct.stockBalances.filter((balance) => allowedStoreIds.has(balance.storeId));
  const available = Math.max(0, balances.reduce((sum, balance) => sum + decimalToNumber(balance.available), 0));
  const asOf = balances.reduce<Date | null>(
    (latest, balance) => !latest || balance.syncedAt > latest ? balance.syncedAt : latest,
    null
  );
  return {
    branchId: configured.id,
    name: configuredBranchName(configured),
    address: configured.publicAddress?.trim() || configured.branch.address || null,
    phone: configured.publicPhone?.trim() || configured.branch.phone || null,
    availability: available > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
    available,
    uom: localProduct.uomName?.trim() || null,
    price: localProduct.salePriceCents > 0 ? localProduct.salePriceCents / 100 : null,
    currency: localProduct.currencyName?.trim() || "руб.",
    asOf: (asOf ?? localProduct.updatedAt).toISOString(),
  };
}

export function mapStorefrontOilCard(row: StorefrontOilRow, storefront: PublicStorefrontContext): PublicOilCard {
  const source = row.contentSource;
  const offers = storefront.branches.map((configured) => toPublicOffer(row, configured));
  const knownPrices = [...new Set(offers.map((offer) => offer.price).filter((price): price is number => price != null))];
  const updatedAt = offers.reduce(
    (latest, offer) => offer.asOf && offer.asOf > latest ? offer.asOf : latest,
    row.updatedAt.toISOString()
  );
  return {
    id: row.id,
    slug: row.slug,
    name: row.publicName?.trim() || source.name,
    description: row.publicDescription?.trim() || source.description?.trim() || undefined,
    article: source.article ?? undefined,
    brand: source.brand ?? undefined,
    sae: source.sae ?? undefined,
    acea: source.acea ?? undefined,
    apiSpec: source.apiSpec ?? undefined,
    ilsac: source.ilsac ?? undefined,
    oem: source.oem ?? undefined,
    packageVolume: source.packageVolume ?? undefined,
    uom: source.uomName ?? undefined,
    price: knownPrices.length === 1 ? knownPrices[0] : null,
    currency: offers.find((offer) => offer.price != null)?.currency ?? source.currencyName ?? "руб.",
    available: offers.reduce((sum, offer) => sum + (offer.available ?? 0), 0),
    pricesDiffer: knownPrices.length > 1,
    offers,
    updatedAt,
    imageHref: row.publicImageHref ?? undefined,
  };
}

function toOilProduct(row: StorefrontOilRow): OilProduct {
  const source = row.contentSource;
  const volume =
    source.packageVolume != null
      ? Number.parseFloat(source.packageVolume.replace(",", ".").replace(/[^\d.]/g, ""))
      : Number.NaN;
  const volumeLiters = Number.isFinite(volume) ? volume : parsePackVolumeLitersFromOilName(source.name) ?? undefined;

  return {
    id: row.id,
    name: row.publicName?.trim() || source.name,
    article: source.article ?? undefined,
    price: source.salePriceCents / 100,
    currency: source.currencyName ?? "руб.",
    meta: { href: `local://product/${row.id}` },
    requirements_norm: {
      sae: mergeUnique([normalizeSAE(source.sae ?? ""), normalizeSAE(source.name)]),
      oem: mergeUnique([normalizeOEM(source.oem ?? ""), normalizeOEM(source.name)]),
      acea: mergeUnique([normalizeACEA(source.acea ?? ""), normalizeACEA(source.aceaExtra ?? ""), normalizeACEA(source.name)]),
      api: mergeUnique([normalizeAPI(source.apiSpec ?? ""), normalizeAPI(source.name)]),
      ilsac: mergeUnique([normalizeILSAC(source.ilsac ?? ""), normalizeILSAC(source.name)]),
    },
    volume_liters: volumeLiters,
    imageHref: row.publicImageHref ?? undefined,
  };
}

function publicOilWhere(storefrontId: string, params: PublicOilQuery): Prisma.StorefrontProductWhereInput {
  const search = compact(params.search);
  const brand = compact(params.brand);
  const sae = compact(params.sae);
  const acea = compact(params.acea);
  const api = compact(params.api);
  const sourceFilters: Prisma.LocalProductWhereInput[] = [];

  if (search) {
    sourceFilters.push({
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { article: { contains: search, mode: "insensitive" as const } },
        { brand: { contains: search, mode: "insensitive" as const } },
        { searchText: { contains: search.toLowerCase(), mode: "insensitive" as const } },
      ],
    });
  }
  if (brand) sourceFilters.push({ brand: { contains: brand, mode: "insensitive" as const } });
  if (sae) sourceFilters.push({ OR: [{ sae: { contains: sae, mode: "insensitive" as const } }, { name: { contains: sae, mode: "insensitive" as const } }] });
  if (acea) sourceFilters.push({ OR: [{ acea: { contains: acea, mode: "insensitive" as const } }, { name: { contains: acea, mode: "insensitive" as const } }] });
  if (api) sourceFilters.push({ OR: [{ apiSpec: { contains: api, mode: "insensitive" as const } }, { name: { contains: api, mode: "insensitive" as const } }] });
  return {
    storefrontId,
    publicationState: "PUBLISHED",
    ...(sourceFilters.length ? { contentSource: { AND: sourceFilters } } : {}),
  };
}

async function loadStorefrontOilRows(params: PublicOilQuery = {}, options: { limit?: number; offset?: number }) {
  const storefront = await resolvePublicStorefront();
  const where = publicOilWhere(storefront.id, params);
  const [rows, total] = await Promise.all([
    prisma.storefrontProduct.findMany({
      where,
      select: STOREFRONT_OIL_ROW_SELECT,
      orderBy: [{ publicName: "asc" }, { id: "asc" }],
      skip: Math.max(0, options.offset ?? 0),
      ...(options.limit == null ? {} : { take: options.limit }),
    }),
    prisma.storefrontProduct.count({ where }),
  ]);
  return { storefront, rows, total };
}

async function loadPublicOilMatches(params: PublicOilQuery = {}) {
  const { storefront, rows } = await loadStorefrontOilRows(params, {});
  return rows.map((row) => ({
    card: mapStorefrontOilCard(row, storefront),
    product: toOilProduct(row),
  }));
}

export async function listPublicOils(params: PublicOilQuery = {}) {
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const offset = Math.max(0, params.offset ?? 0);
  const { storefront, rows, total } = await loadStorefrontOilRows(params, { limit, offset });
  const oils = rows.map((row) => mapStorefrontOilCard(row, storefront));
  return {
    count: oils.length,
    total,
    limit,
    offset,
    nextOffset: offset + oils.length < total ? offset + oils.length : null,
    oils,
  };
}

export async function getPublicOilById(idOrSlug: string) {
  const value = idOrSlug.trim();
  if (!value) return null;
  const storefront = await resolvePublicStorefront();
  const row = await prisma.storefrontProduct.findFirst({
    where: {
      storefrontId: storefront.id,
      publicationState: "PUBLISHED",
      OR: [{ id: value }, { slug: value }],
    },
    include: {
      contentSource: true,
      bindings: {
        where: { status: "CONFIRMED" },
        include: { localProduct: { include: { stockBalances: true } } },
      },
    },
  });
  return row ? mapStorefrontOilCard(row, storefront) : null;
}

export async function getPublicOilFilters() {
  const storefront = await resolvePublicStorefront();
  const rows = await prisma.storefrontProduct.findMany({
    where: { storefrontId: storefront.id, publicationState: "PUBLISHED" },
    select: { contentSource: { select: { brand: true, sae: true, packageVolume: true, oem: true } } },
  });
  const unique = (values: Array<string | undefined>) => [...new Set(values.map(compact).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  return {
    brands: unique(rows.map((row) => row.contentSource.brand ?? undefined)),
    sae: unique(rows.map((row) => row.contentSource.sae ?? undefined)),
    packageVolumes: unique(rows.map((row) => row.contentSource.packageVolume ?? undefined)),
    oem: unique(rows.flatMap((row) => normalizeOEM(row.contentSource.oem ?? ""))),
  };
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

  const localOils = await loadPublicOilMatches({});
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
