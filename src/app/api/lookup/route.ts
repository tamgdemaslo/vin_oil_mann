import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { LookupResult, MoySkladItem, OilInfo, VinDecoded } from "@/types/lookup";
import type { OilRequirements } from "@/types/oil";
import {
  getOilRequirementsFromOpenAI,
  fetchOilCandidatesByRequirements,
  fetchOilProductsFromMoySklad,
  scoreAndMatch,
} from "@/lib/oil-recommendations";
import { getMoySkladAuthHeader, MOYSKLAD_BASE } from "@/lib/moysklad";
import { normalizeACEA, normalizeSAE } from "@/lib/oil-normalizer";
import { getVinLookupCache, setVinLookupCache } from "@/lib/vin-lookup-cache";
import { partsCatalogsRequest } from "@/lib/parts-catalogs";

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  return key ? new OpenAI({ apiKey: key }) : null;
}

const SERPER_URL = "https://google.serper.dev/search";

type CarInfoItem = {
  catalogId?: string;
  carId?: string;
  catalog_id?: string;
  car_id?: string;
  criteria?: string;
  title?: string;
  vin?: string;
  /** Parts-catalogs отдаёт brand / modelName отдельно от title */
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
type GroupItem = { id?: string; groupId?: string; name?: string; hasParts?: boolean; hasSubgroups?: boolean };

function getGroupId(g: GroupItem): string | undefined {
  return g.id ?? g.groupId;
}

function inferTransmissionInfo(decoded: VinDecoded | null): OilInfo["transmission"] | undefined {
  const make = (decoded?.make ?? "").toLowerCase();
  const model = (decoded?.model ?? "").toLowerCase();
  const isQ7 = make.includes("audi") && model.includes("q7");
  const isTouareg = (make.includes("volkswagen") || make === "vw") && model.includes("touareg");
  if (!isQ7 && !isTouareg) return undefined;

  return {
    code: "0C8",
    gearbox: "Aisin TR-80SD / TR-80SC, 8AT",
    fluid: "Toyota ATF WS",
    partialVolumeLiters: "~7",
    fullVolumeLiters: "~14-15",
    levelCheckTempC: "35-45",
    note: "При пинках и затяжных переключениях проблема может быть не только в жидкости, но и в гидроблоке.",
  };
}
type PartItem = { number?: string; name?: string; description?: string; notice?: string; groupPath?: string };
type CollectedGroup = { item: GroupItem; pathNames: string[] };

const LOOKUP_CACHE_TTL_MS = Math.max(60_000, parseInt(process.env.LOOKUP_CACHE_MS ?? "600000", 10) || 600_000);
const STOCK_REPORT_CACHE_TTL_MS = Math.max(5_000, parseInt(process.env.STOCK_REPORT_CACHE_MS ?? "30000", 10) || 30_000);
const MOYSKLAD_TIMEOUT_MS = Math.max(5_000, parseInt(process.env.MOYSKLAD_TIMEOUT_MS ?? "15000", 10) || 15_000);

type StockByStoreEntry = { name: string; stock: number; reserve?: number };
type StockReportRow = {
  meta?: { href?: string };
  assortment?: { meta?: { href?: string } };
  stockByStore?: StockByStoreEntry[];
};

const lookupCache = new Map<string, { at: number; result: LookupResult }>();
let stockByStoreReportCache:
  | {
      at: number;
      rows: StockReportRow[];
      byProductId: Map<string, { stockByStore?: StockByStoreEntry[] }>;
    }
  | null = null;
let stockByStoreReportInFlight:
  | Promise<StockReportRow[]>
  | null = null;

function cloneLookupResult(result: LookupResult): LookupResult {
  return JSON.parse(JSON.stringify(result)) as LookupResult;
}

function hasUsefulDecoded(decoded: VinDecoded | null | undefined): boolean {
  return Boolean(
    decoded &&
      [
        decoded.make,
        decoded.model,
        decoded.modelYear,
        decoded.modification,
        decoded.engineSeries,
        decoded.generation,
        decoded.displacementL,
        decoded.fuelTypePrimary,
      ].some((value) => typeof value === "string" && value.trim())
  );
}

function hasUsefulOilInfo(oilInfo: OilInfo | null | undefined): boolean {
  return Boolean(
    oilInfo &&
      [
        oilInfo.approval,
        oilInfo.fillVolumeLiters,
        oilInfo.oilFilterOem,
        oilInfo.fuelFilterOem,
        oilInfo.airFilterOem,
        oilInfo.cabinFilterOem,
      ].some((value) => typeof value === "string" && value.trim()) ||
      Boolean(
        oilInfo &&
          ((oilInfo.sae?.length ?? 0) > 0 ||
            (oilInfo.acea?.length ?? 0) > 0 ||
            (oilInfo.api?.length ?? 0) > 0 ||
            (oilInfo.ilsac?.length ?? 0) > 0 ||
            oilInfo.transmission)
      )
  );
}

function hasUsefulLookupPayload(payload: { decoded?: VinDecoded | null; oilInfo?: OilInfo | null } | null | undefined): boolean {
  return Boolean(payload && (hasUsefulDecoded(payload.decoded) || hasUsefulOilInfo(payload.oilInfo)));
}

function getCachedLookupResult(vin: string): LookupResult | null {
  if (process.env.NODE_ENV !== "production") return null;
  const cached = lookupCache.get(vin);
  if (!cached) return null;
  if (Date.now() - cached.at > LOOKUP_CACHE_TTL_MS) {
    lookupCache.delete(vin);
    return null;
  }
  return cloneLookupResult(cached.result);
}

function setCachedLookupResult(vin: string, result: LookupResult): void {
  if (process.env.NODE_ENV !== "production") return;
  lookupCache.set(vin, { at: Date.now(), result: cloneLookupResult(result) });
}

async function fetchMoySkladJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MOYSKLAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) return (await res.json()) as T;
      console.warn("[lookup] MoySklad request failed", res.status, url);
    } catch (error) {
      console.warn("[lookup] MoySklad request error", error instanceof Error ? error.message : String(error), url);
    } finally {
      clearTimeout(timeoutId);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  return null;
}

function extractProductIdFromHref(href?: string): string | null {
  // В MoySklad в product href обычно UUID-подобный идентификатор, но формат может
  // отличаться (иногда встречаются символы вне [a-f]).
  // Поэтому захватываем любые буквенно-цифровые символы и дефисы до следующего разделителя.
  const match = (href ?? "").match(/entity\/product\/([0-9a-zA-Z-]+)/i);
  return match?.[1] ?? null;
}

function mergeStockByStoreEntries(entries: StockByStoreEntry[] = []): StockByStoreEntry[] {
  const byStore = new Map<string, StockByStoreEntry>();
  for (const entry of entries) {
    const name = (entry.name ?? "").trim();
    if (!name) continue;
    const prev = byStore.get(name);
    byStore.set(name, {
      name,
      stock: (prev?.stock ?? 0) + (entry.stock ?? 0),
      reserve: (prev?.reserve ?? 0) + (entry.reserve ?? 0),
    });
  }
  return [...byStore.values()];
}

function buildStockByProductIdMap(
  rows: StockReportRow[]
): Map<string, { stockByStore?: StockByStoreEntry[] }> {
  const map = new Map<string, { stockByStore?: StockByStoreEntry[] }>();
  for (const row of rows) {
    const productId = extractProductIdFromHref(row.assortment?.meta?.href ?? row.meta?.href);
    if (!productId) continue;
    const prev = map.get(productId)?.stockByStore ?? [];
    map.set(productId, {
      stockByStore: mergeStockByStoreEntries([...prev, ...(row.stockByStore ?? [])]),
    });
  }
  return map;
}

async function getCachedStockByStoreRows(
  headers: Record<string, string>
): Promise<StockReportRow[]> {
  if (stockByStoreReportCache && Date.now() - stockByStoreReportCache.at <= STOCK_REPORT_CACHE_TTL_MS) {
    return stockByStoreReportCache.rows;
  }
  if (stockByStoreReportInFlight) return stockByStoreReportInFlight;
  stockByStoreReportInFlight = (async () => {
    try {
      const limit = 1000;
      let offset = 0;
      let size = Number.POSITIVE_INFINITY;
      const rows: StockReportRow[] = [];

      while (offset < size) {
        const stockData = await fetchMoySkladJson<{
          meta?: { size?: number; limit?: number; offset?: number };
          rows?: StockReportRow[];
        }>(`${MOYSKLAD_BASE}/report/stock/bystore?limit=${limit}&offset=${offset}`, headers);
        if (!stockData) {
          throw new Error("Не удалось загрузить общий отчет остатков МойСклад");
        }

        const chunk = stockData.rows ?? [];
        rows.push(...chunk);

        const reportedSize = stockData.meta?.size;
        size = typeof reportedSize === "number" && reportedSize > 0 ? reportedSize : rows.length;
        if (chunk.length < limit) break;
        offset += limit;
      }

      stockByStoreReportCache = { at: Date.now(), rows, byProductId: buildStockByProductIdMap(rows) };
      return rows;
    } finally {
      stockByStoreReportInFlight = null;
    }
  })();
  return stockByStoreReportInFlight;
}

async function getCachedStockByProductIdMap(
  headers: Record<string, string>
): Promise<Map<string, { stockByStore?: StockByStoreEntry[] }>> {
  await getCachedStockByStoreRows(headers);
  if (stockByStoreReportCache?.byProductId) return stockByStoreReportCache.byProductId;
  // На случай hot-reload и старого кэша без byProductId.
  return buildStockByProductIdMap(stockByStoreReportCache?.rows ?? []);
}

async function getDirectStockByProductId(
  headers: Record<string, string>,
  productId: string
): Promise<StockByStoreEntry[]> {
  const productHref = `${MOYSKLAD_BASE}/entity/product/${productId}`;
  const stock = await fetchMoySkladJson<{ rows?: StockReportRow[] }>(
    `${MOYSKLAD_BASE}/report/stock/bystore?filter=${encodeURIComponent(`product=${productHref}`)}&limit=100`,
    headers
  );
  return mergeStockByStoreEntries((stock?.rows ?? []).flatMap((row) => row.stockByStore ?? []));
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

/** Извлечь основные данные автомобиля из car/info, включая параметры Parts Catalogs. */
function vehicleFromCarInfoItem(first: CarInfoItem): {
  make?: string;
  model?: string;
  modelYear?: string;
  modification?: string;
  engineSeries?: string;
  generation?: string;
  market?: string;
  steering?: string;
  bodyClass?: string;
  gearType?: string;
  displacementL?: string;
  fuelTypePrimary?: string;
} {
  const params = new Map<string, string>();
  for (const param of first.parameters ?? []) {
    const value = param.value == null ? "" : String(param.value).trim();
    if (!value) continue;
    const key = (param.key ?? "").trim().toLowerCase();
    const name = (param.name ?? "").trim().toLowerCase();
    if (key) params.set(key, value);
    if (name) params.set(name, value);
  }

  const yearFromProductionDate = (params.get("production date") ?? "").match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  const yearFromProductionPeriod = (params.get("prod_period") ?? params.get("production period") ?? "").match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  const make = (first.brand ?? first.make ?? first.manufacturer ?? "").trim();
  const model = (first.modelName ?? first.model ?? "").trim();
  const modelYear = (first.modelYear ?? first.year ?? params.get("year") ?? yearFromProductionDate ?? yearFromProductionPeriod ?? "").trim();
  const modification = (params.get("car_name") ?? params.get("model") ?? first.title ?? "").trim();
  const rawEngine = (
    params.get("engine") ??
    params.get("spec_engine") ??
    params.get("engine code") ??
    params.get("engine_code") ??
    ""
  ).trim();
  const carParameters = (params.get("parameters") ?? params.get("car parameters") ?? "").trim();
  const description = (first.description ?? "").trim();
  const engineFromDescription =
    description.match(/\bEngine(?:\s+\w+)?:\s*([^.;\r\n]+)/i)?.[1]?.trim() ??
    description.match(/\b([A-ZА-Я0-9]{2,8})\s+engine\b/i)?.[1]?.trim() ??
    "";
  const engineFromParameters = carParameters.match(/\b([1-9]\d{3})\b/)?.[1] ?? "";
  const engineSeries = (rawEngine || engineFromDescription || engineFromParameters).trim();
  const displacementFromEngine = rawEngine.match(/\b(\d(?:[.,]\d)?)\s*L\b/i)?.[1]?.replace(",", ".") ?? "";
  const displacementFromParameters = carParameters.match(/\b([1-9]\d{3})\b/)?.[1];
  const displacementL = [
    params.get("engine_cc"),
    params.get("engine size"),
    displacementFromEngine,
    displacementFromParameters ? String(Number(displacementFromParameters) / 1000) : "",
  ].find((value) => value && value.trim())?.trim() ?? "";
  const fuelTypePrimary = (params.get("fuel_type") ?? params.get("fuel type") ?? "").trim();
  const generation = (params.get("spec_series") ?? params.get("series") ?? first.description?.replace(/^series:\s*/i, "") ?? "").trim();
  const market = (params.get("sales_region") ?? params.get("region") ?? "").trim();
  const steering = (params.get("steering") ?? "").trim();
  const bodyClass = (params.get("body_type") ?? "").trim();
  const gearType = (params.get("trans_type") ?? params.get("transmission") ?? params.get("transmission type") ?? "").trim();

  if (make || model || modelYear || modification || engineSeries) {
    return {
      make: make || undefined,
      model: model || undefined,
      modelYear: modelYear || undefined,
      modification: modification || undefined,
      engineSeries: engineSeries || undefined,
      generation: generation || undefined,
      market: market || undefined,
      steering: steering || undefined,
      bodyClass: bodyClass || undefined,
      gearType: gearType || undefined,
      displacementL: displacementL || undefined,
      fuelTypePrimary: fuelTypePrimary || undefined,
    };
  }

  const title = (first.title ?? "").trim();
  if (!title) return {};
  const parts = title.split(/\s+/);
  const yearMatch = parts.find((p) => /^\d{4}$/.test(p));
  const yearIdx = yearMatch ? parts.indexOf(yearMatch) : -1;
  if (yearIdx >= 0) {
    const modelYearStr = parts[yearIdx];
    const before = parts.slice(0, yearIdx);
    const makeStr = before[0] ?? "";
    const modelStr = before.slice(1).join(" ") || "";
    return { make: makeStr || undefined, model: modelStr || undefined, modelYear: modelYearStr || undefined };
  }
  if (parts.length >= 2) return { make: parts[0], model: parts.slice(1).join(" ") };
  if (parts.length === 1) return { make: parts[0] };
  return {};
}

/** Подбор фильтров по VIN через Parts Catalogs API (группа Filters MPCfqbE1NjM: масляный, топливный, воздушный, салонный — см. проект API каталогов запчастей по VIN). */
async function getFiltersFromPartsCatalogs(vin: string): Promise<{
  oilFilterOem?: string;
  fuelFilterOem?: string;
  airFilterOem?: string;
  cabinFilterOem?: string;
  make?: string;
  model?: string;
  modelYear?: string;
  modification?: string;
  engineSeries?: string;
  generation?: string;
  market?: string;
  steering?: string;
  bodyClass?: string;
  gearType?: string;
  displacementL?: string;
  fuelTypePrimary?: string;
}> {
  const cleanVin = vin.replace(/\s/g, "").toUpperCase().replace(/-/g, "");
  if (cleanVin.length < 8) {
    console.log("[Parts Catalogs] VIN слишком короткий:", cleanVin);
    return {};
  }

  console.log("[Parts Catalogs] Запрос /car/info q=", cleanVin);
  const { status, data: carData } = await partsCatalogsRequest("/car/info", { q: cleanVin });
  if (status !== 200 || !carData) {
    console.log("[Parts Catalogs] car/info status=", status, "data=", typeof carData === "object" ? JSON.stringify(carData).slice(0, 200) : carData);
    return {};
  }

  const items = getCarInfoItems(carData);
  const first = items[0] as CarInfoItem | undefined;
  if (!first) {
    console.log("[Parts Catalogs] Нет первой записи в car/info");
    return {};
  }
  const catalogId = first.catalogId ?? first.catalog_id;
  const carId = first.carId ?? first.car_id;
  const criteria = (first.criteria ?? "").trim();
  console.log("[Parts Catalogs] car/info ok, title=", first.title, "catalogId=", catalogId, "carId=", carId?.slice(0, 12) + "...");
  if (!catalogId || !carId) {
    console.log("[Parts Catalogs] Нет catalogId или carId");
    return {};
  }

  const getGroups = async (parentId?: string): Promise<GroupItem[]> => {
    const params: Record<string, string> = { carId };
    if (parentId) params.groupId = parentId;
    const { status: st, data } = await partsCatalogsRequest(`/catalogs/${catalogId}/groups2/`, params);
    if (st !== 200) return [];
    if (Array.isArray(data)) return data as GroupItem[];
    const o = data as Record<string, unknown>;
    return (o.items ?? o.groups ?? []) as GroupItem[];
  };

  const getParts = async (groupId: string): Promise<PartItem[]> => {
    const params: Record<string, string> = { carId, groupId };
    if (criteria) params.criteria = criteria;
    const { status: st, data } = await partsCatalogsRequest(`/catalogs/${catalogId}/parts2`, params);
    if (st !== 200) return [];
    const partGroups = (data as Record<string, unknown>)?.partGroups as { parts?: PartItem[] }[] | undefined;
    if (!Array.isArray(partGroups)) return [];
    return partGroups.flatMap((g) => g.parts ?? []);
  };

  /** Рекурсивно собираем все группы с hasParts без жёсткого лимита глубины. */
  async function collectGroupsWithParts(
    parentId: string | undefined,
    visited = new Set<string>(),
    parentPathNames: string[] = []
  ): Promise<CollectedGroup[]> {
    if (!parentId) return [];
    if (visited.has(parentId)) return [];
    visited.add(parentId);

    const list = await getGroups(parentId);
    const out: CollectedGroup[] = [];
    const withSub = list.filter((g) => g.hasSubgroups);
    const withParts = list.filter((g) => g.hasParts);
    out.push(
      ...withParts.map((item) => ({
        item,
        pathNames: [...parentPathNames, (item.name ?? "").trim()].filter(Boolean),
      }))
    );
    if (withSub.length > 0) {
      const subResults = await Promise.all(
        withSub.map((g) => {
          const id = getGroupId(g);
          const nextPathNames = [...parentPathNames, (g.name ?? "").trim()].filter(Boolean);
          return id ? collectGroupsWithParts(id, visited, nextPathNames) : Promise.resolve([]);
        })
      );
      subResults.forEach((arr) => out.push(...arr));
    }
    return out;
  }

  const top = await getGroups();
  console.log("[Parts Catalogs] Групп верхнего уровня:", top.length);

  // Принцип из "vin pin": фильтры всегда в группе "Filters" — обходим только её (меньше запросов, точнее результат)
  const FILTERS_GROUP_ID = "MPCfqbE1NjM";
  let filtersId: string | undefined;
  for (const g of top) {
    const name = (g.name ?? "").trim().toLowerCase();
    const id = getGroupId(g);
    if (name === "filters" || id === FILTERS_GROUP_ID) {
      filtersId = id;
      break;
    }
  }

  let groupsWithParts: CollectedGroup[];
  if (filtersId) {
    console.log("[Parts Catalogs] Найдена группа Filters, обход только внутри неё");
    groupsWithParts = await collectGroupsWithParts(filtersId, new Set<string>(), ["Filters"]);
  } else {
    // Fallback: каталог без группы Filters — обходим все верхние группы как раньше
    const withPartsTop = top.filter((g) => g.hasParts).map((item) => ({
      item,
      pathNames: [(item.name ?? "").trim()].filter(Boolean),
    }));
    const withSubTop = top.filter((g) => g.hasSubgroups);
    const subResults = await Promise.all(
      withSubTop.map((g) => {
        const id = getGroupId(g);
        return id ? collectGroupsWithParts(id, new Set<string>(), [(g.name ?? "").trim()].filter(Boolean)) : Promise.resolve([] as CollectedGroup[]);
      })
    );
    groupsWithParts = [...withPartsTop, ...subResults.flat()];
  }
  console.log("[Parts Catalogs] Групп с запчастями (hasParts):", groupsWithParts.length);

  const allParts: PartItem[] = [];
  const partPromises = groupsWithParts.map((g) => {
    const id = getGroupId(g.item);
    return id
      ? getParts(id).then((parts) =>
          parts.map((part) => ({
            ...part,
            groupPath: g.pathNames.join(" > "),
          }))
        )
      : Promise.resolve([]);
  });
  const partArrays = await Promise.all(partPromises);
  partArrays.forEach((arr) => allParts.push(...arr));
  console.log("[Parts Catalogs] Всего запчастей из групп:", allParts.length);

  // Сначала пробуем точные названия как в "vin pin", но некоторые каталоги называют
  // фильтры иначе: Air cleaner / Filter element / Pollen filter и т.п.
  const nameIs = (p: PartItem, ...exactNames: string[]): boolean => {
    const name = (p.name ?? "").trim();
    return exactNames.some((n) => name === n.trim());
  };
  const partText = (p: PartItem): string =>
    [p.name, p.description, p.notice, p.groupPath]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const isCabinPart = (p: PartItem): boolean => {
    const text = partText(p);
    return /\b(cabin|interior|pollen)\b/.test(text);
  };
  const isAirPart = (p: PartItem): boolean => {
    const text = partText(p);
    return !isCabinPart(p) && /\bair\b/.test(text) && /\b(filter|cleaner|element)\b/.test(text);
  };
  const isFuelPart = (p: PartItem): boolean => {
    const text = partText(p);
    return /\bfuel\b/.test(text) && /\b(filter|cleaner|element)\b/.test(text);
  };
  const isOilPart = (p: PartItem): boolean => {
    const text = partText(p);
    return /\boil\b/.test(text) && /\b(filter|cleaner|element)\b/.test(text);
  };

  // В некоторых каталогах масляный фильтр лежит внутри ветки Oil pump,
  // поэтому groupPath для него ненадёжен: сперва точное имя, затем мягкий fallback.
  const exactOilParts = allParts.filter((p) => nameIs(p, "Engine oil filter", "Oil filter"));
  const exactFuelParts = allParts.filter((p) => nameIs(p, "Fuel filter"));
  const exactAirParts = allParts.filter((p) => nameIs(p, "Air filter"));
  const exactCabinParts = allParts.filter((p) => nameIs(p, "Interior air filter", "Air Filter - Cabin"));

  const oilParts = exactOilParts.length > 0 ? exactOilParts : allParts.filter(isOilPart);
  const fuelParts = exactFuelParts.length > 0 ? exactFuelParts : allParts.filter(isFuelPart);
  const airParts = exactAirParts.length > 0 ? exactAirParts : allParts.filter(isAirPart);
  const cabinParts = exactCabinParts.length > 0 ? exactCabinParts : allParts.filter(isCabinPart);
  console.log(
    "[Parts Catalogs] Фильтры после fallback-классификации:",
    "масляный=",
    oilParts.length,
    "топливный=",
    fuelParts.length,
    "воздушный=",
    airParts.length,
    "салонный=",
    cabinParts.length
  );

  /** Собирает до maxCount уникальных OEM-номеров (чтобы пробивать в МойСклад по нескольким вариантам). */
  const uniqueNumbers = (parts: PartItem[], maxCount: number): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      if (out.length >= maxCount) break;
      const raw = (p.number ?? p.name ?? "").trim().toUpperCase().replace(/\s+/g, "");
      const compact = raw.replace(/[^A-Z0-9]/g, "");
      if (!compact || compact.length < 5 || seen.has(compact)) continue;
      seen.add(compact);
      out.push(compact);
    }
    return out;
  };

  const MAX_OEM_PER_FILTER = 8;
  const vehicle = vehicleFromCarInfoItem(first);
  const result = {
    oilFilterOem: uniqueNumbers(oilParts, MAX_OEM_PER_FILTER).join(", ") || undefined,
    fuelFilterOem: uniqueNumbers(fuelParts, MAX_OEM_PER_FILTER).join(", ") || undefined,
    airFilterOem: uniqueNumbers(airParts, MAX_OEM_PER_FILTER).join(", ") || undefined,
    cabinFilterOem: uniqueNumbers(cabinParts, MAX_OEM_PER_FILTER).join(", ") || undefined,
    ...vehicle,
  };
  console.log("[Parts Catalogs] Итог:", result);
  return result;
}

/** id доп. поля «OEM PARTS». В filter по доке нужна полная ссылка: .../metadata/attributes/{id}=<значение> */
/** Совпадает с доп. полем «OEM PARTS» в вашей организации МойСклад (можно переопределить в .env). */
const MOYSKLAD_OEM_ATTRIBUTE_ID =
  process.env.MOYSKLAD_OEM_ATTRIBUTE_ID?.trim() || "d1aad1ea-14e1-11f1-0a80-0eb200223523";
const MOYSKLAD_OEM_ATTRIBUTE_HREF = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MOYSKLAD_OEM_ATTRIBUTE_ID}`;

type ProductRow = {
  id: string;
  name: string;
  article?: string;
  meta?: { href: string };
  salePrices?: { value: number; currency?: { name?: string } }[];
  attributes?: { id: string; meta?: { href?: string }; value: string; name?: string }[];
};

type ProductRowWithAttrs = ProductRow & {
  attributes?: { id: string; meta?: { href?: string }; value: string; name?: string }[];
};

type FilterLookupKind = "oil-filter" | "fuel-filter" | "air-filter" | "cabin-filter";
type FilterSearchGroup = { kind: FilterLookupKind; terms: string[] };

function addRowsToProductMap(
  productMap: Map<string, { name: string; article?: string; price: number; currency: string; cell?: string }>,
  rows: ProductRow[]
) {
  for (const row of rows) {
    if (productMap.has(row.id)) continue;
    const priceCents = row.salePrices?.[0]?.value ?? 0;
    const price = priceCents / 100;
    const currency = row.salePrices?.[0]?.currency?.name ?? "руб.";
    let cell: string | undefined;
    for (const a of row.attributes ?? []) {
      const name = (a.name ?? "").toLowerCase();
      if (name.includes("ячейк") || name.includes("cell") || name.includes("яч")) {
        cell = String(a.value);
        break;
      }
    }
    productMap.set(row.id, {
      name: row.name,
      article: row.article,
      price,
      currency,
      cell,
    });
  }
}

function productSearchText(row: ProductRowWithAttrs): string {
  const parts = [row.name ?? "", row.article ?? ""];
  for (const attr of row.attributes ?? []) {
    parts.push(attr.name ?? "");
    parts.push(String(attr.value ?? ""));
  }
  return parts.join(" ").toLowerCase();
}

function productMatchesTerms(row: ProductRowWithAttrs, terms: string[]): boolean {
  const haystack = productSearchText(row).replace(/\s/g, "");
  return terms.some((term) => {
    const needle = term.trim().toLowerCase().replace(/\s/g, "");
    return needle.length >= 2 && haystack.includes(needle);
  });
}

/** Быстрый поиск фильтров в МойСклад: OEM, Mann и обычный search + локальный fallback по атрибутам. */
async function searchMoySkladProductsByTerms(
  rawTerms: string[],
  lookupKind: FilterLookupKind
): Promise<{ items: MoySkladItem[]; error?: string }> {
  const auth = getMoySkladAuthHeader();
  if (!auth) {
    return {
      items: [],
      error: "Укажите MOYSKLAD_TOKEN или пару MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD в .env.local и перезапустите сервер.",
    };
  }

  const headers: Record<string, string> = {
    Authorization: auth,
    "Accept-Encoding": "gzip",
    Accept: "application/json;charset=utf-8",
    "Content-Type": "application/json",
  };

  try {
    const productMap = new Map<
      string,
      { name: string; article?: string; price: number; currency: string; cell?: string }
    >();
    const terms = [...new Set(rawTerms.map((term) => term.trim()).filter(Boolean))].slice(0, 8);
    const urls: string[] = [];
    for (const term of terms) {
      const compact = term.replace(/\s/g, "");
      if (compact.length < 2) continue;
      urls.push(
        `${MOYSKLAD_BASE}/entity/product?filter=${encodeURIComponent(MOYSKLAD_OEM_ATTRIBUTE_HREF)}~${encodeURIComponent(
          term
        )}&limit=30&expand=attributes`
      );
    }

    const responses = await Promise.all(
      [...new Set(urls)].map(async (url) => {
        const data = await fetchMoySkladJson<{ rows?: ProductRow[] }>(url, headers);
        return data?.rows ?? [];
      })
    );
    for (const rows of responses) addRowsToProductMap(productMap, rows);

    if (productMap.size === 0 && terms.length > 0) {
      // Если OEM attribute не сработал (например, из-за отличий в форматировании номеров),
      // делаем лёгкий fallback по обычному `search` по тем же OEM-строкам.
      // Это не "поиск по названию" фильтра как таковой — источник термов всё равно OEM PARTS.
      const fallbackUrls = terms.map(
        (term) => `${MOYSKLAD_BASE}/entity/product?search=${encodeURIComponent(term)}&limit=30&expand=attributes`
      );
      const fallbackResponses = await Promise.all(
        [...new Set(fallbackUrls)].map(async (url) => {
          const data = await fetchMoySkladJson<{ rows?: ProductRow[] }>(url, headers);
          return data?.rows ?? [];
        })
      );
      for (const rows of fallbackResponses) addRowsToProductMap(productMap, rows);
    }

    if (productMap.size === 0 && terms.length > 0) {
      // Последний fallback: забираем пачку товаров с атрибутами и матчим локально
      // по тем же OEM-термам. Это помогает, когда строка хранится в атрибуте
      // нестандартно и не отрабатывает через обычный filter/search.
      const batch = await fetchMoySkladJson<{ rows?: ProductRowWithAttrs[] }>(
        `${MOYSKLAD_BASE}/entity/product?limit=500&expand=attributes`,
        headers
      );
      if (batch?.rows?.length) {
        for (const row of batch.rows) {
          if (productMatchesTerms(row, terms)) addRowsToProductMap(productMap, [row]);
        }
      }
    }

    const productIds = [...productMap.keys()];
    if (productIds.length === 0) return { items: [] };

    const items: MoySkladItem[] = [];

    const stockByProductId = await getCachedStockByProductIdMap(headers);
    if (stockByProductId.size === 0) {
      for (const [id, p] of productMap) {
        items.push({ ...p, quantity: 0, store: "—", productId: id, lookupKind });
      }
      return { items };
    }

    for (const [id, p] of productMap) {
      const entry = stockByProductId.get(id);
      const stores = entry?.stockByStore ?? [];
      if (!entry || stores.length === 0) {
        items.push({ ...p, quantity: 0, store: "—", productId: id, lookupKind });
        continue;
      }
      for (const s of stores) {
        items.push({
          name: p.name,
          article: p.article,
          price: p.price,
          currency: p.currency,
          quantity: s.stock,
          store: s.name,
          cell: p.cell,
          productId: id,
          lookupKind,
        });
      }
    }

    return { items };
  } catch (e) {
    return {
      items: [],
      error: e instanceof Error ? e.message : "Ошибка МойСклад",
    };
  }
}

/** Получить остатки по списку productId и собрать MoySkladItem[] (один элемент на склад). */
async function getStockItemsForProducts(
  productInfos: Array<{ id: string; name: string; article?: string; price: number; currency: string; volumeLiters?: number; imageHref?: string }>
): Promise<MoySkladItem[]> {
  const auth = getMoySkladAuthHeader();
  if (!auth || productInfos.length === 0) return [];
  const headers: Record<string, string> = {
    Authorization: auth,
    "Accept-Encoding": "gzip",
    Accept: "application/json;charset=utf-8",
  };
  const byId = new Map(productInfos.map((p) => [p.id, p]));
  try {
    const stockByProductId = await getCachedStockByProductIdMap(headers);
    const items: MoySkladItem[] = [];

    if (stockByProductId.size === 0) {
      console.warn("[lookup] stock report is empty; using direct stock lookup for selected oils");
      const direct = await Promise.all(
        [...byId.values()].map(async (p) => ({
          product: p,
          stores: await getDirectStockByProductId(headers, p.id),
        }))
      );
      for (const { product: p, stores } of direct) {
        if (stores.length === 0) {
          items.push({
            ...p,
            quantity: 0,
            store: "—",
            productId: p.id,
            volumeLiters: p.volumeLiters,
            imageHref: p.imageHref,
            lookupKind: "oil",
          });
          continue;
        }
        for (const s of stores) {
          items.push({
            name: p.name,
            article: p.article,
            price: p.price,
            currency: p.currency,
            quantity: s.stock,
            store: s.name,
            productId: p.id,
            volumeLiters: p.volumeLiters,
            imageHref: p.imageHref,
            lookupKind: "oil",
          });
        }
      }
      return items;
    }

    for (const p of byId.values()) {
      const entry = stockByProductId.get(p.id);
      const stores = entry?.stockByStore ?? [];
      if (!entry || stores.length === 0) {
        items.push({
          ...p,
          quantity: 0,
          store: "—",
          productId: p.id,
          volumeLiters: p.volumeLiters,
          imageHref: p.imageHref,
          lookupKind: "oil",
        });
        continue;
      }

      for (const s of stores) {
        items.push({
          name: p.name,
          article: p.article,
          price: p.price,
          currency: p.currency,
          quantity: s.stock,
          store: s.name,
          productId: p.id,
          volumeLiters: p.volumeLiters,
          imageHref: p.imageHref,
          lookupKind: "oil",
        });
      }
    }
    return items;
  } catch (error) {
    console.warn("[lookup] stock report failed; using direct stock lookup for selected oils", error);
    const direct = await Promise.all(
      productInfos.map(async (p) => ({
        product: p,
        stores: await getDirectStockByProductId(headers, p.id),
      }))
    );
    const items: MoySkladItem[] = [];
    for (const { product: p, stores } of direct) {
      if (stores.length === 0) {
        items.push({
          ...p,
          quantity: 0,
          store: "—",
          productId: p.id,
          volumeLiters: p.volumeLiters,
          imageHref: p.imageHref,
          lookupKind: "oil" as const,
        });
        continue;
      }
      for (const s of stores) {
        items.push({
          name: p.name,
          article: p.article,
          price: p.price,
          currency: p.currency,
          quantity: s.stock,
          store: s.name,
          productId: p.id,
          volumeLiters: p.volumeLiters,
          imageHref: p.imageHref,
          lookupKind: "oil" as const,
        });
      }
    }
    return items;
  }
}

/** Нормализует OEM: убирает пробелы — в МойСклад ищет "11428575211", а не "11 42 8 575 211". */
function normalizeOem(oem: string): string {
  return oem.toUpperCase().replace(/[\s-]+/g, "");
}

/** Строка похожа на OEM (цифры, возможны точки/дефисы/латиница), не фраза вроде "нет данных" */
function looksLikeOem(s: string): boolean {
  const t = s.trim();
  if (t.length < 5 || t.length > 25) return false;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 5) return false;
  if (/[а-яё]/i.test(t)) return false;
  if (/\b(нет|не\s+найдено|нет\s+данных|н\/д)\b/i.test(t)) return false;
  return true;
}

function extractOemNumbers(oilInfo: OilInfo): string[] {
  const parts: string[] = [];
  for (const raw of [
    oilInfo.oilFilterOem,
    oilInfo.fuelFilterOem,
    oilInfo.airFilterOem,
    oilInfo.cabinFilterOem,
  ]) {
    if (!raw) continue;
    for (const s of raw.split(/[,;\/]/)) {
      const t = normalizeOem(s.trim());
      if (t.length >= 3 && looksLikeOem(t)) parts.push(t);
      const compact = t.replace(/[^A-Z0-9]/g, "");
      if (compact !== t && looksLikeOem(compact)) parts.push(compact);
      const digitsOnly = compact.replace(/\D/g, "");
      if (digitsOnly && digitsOnly !== compact && looksLikeOem(digitsOnly)) parts.push(digitsOnly);
    }
  }
  return [...new Set(parts)].slice(0, 15);
}

/** Mann-наименования для поиска в МойСклад (по названию/артикулу). */
function extractMannDesignations(oilInfo: OilInfo): string[] {
  const parts: string[] = [];
  for (const raw of [
    oilInfo.oilFilterMann,
    oilInfo.airFilterMann,
    oilInfo.cabinFilterMann,
  ]) {
    if (!raw) continue;
    for (const s of raw.split(/[,;\/]/)) {
      const t = s.trim().replace(/\s+/g, " ").slice(0, 40);
      if (t.length >= 2 && !/\b(нет|не\s+найдено|н\/д)\b/i.test(t)) parts.push(t);
    }
  }
  return [...new Set(parts)].slice(0, 15);
}

/** Только OEM фильтров + Mann — для поиска в МойСклад именно фильтров (без допусков масла). */
function extractSearchTermsForFilters(oilInfo: OilInfo): string[] {
  const oem = extractOemNumbers(oilInfo);
  const mann = extractMannDesignations(oilInfo);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...oem, ...mann]) {
    const key = v.replace(/\s/g, "").toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out.slice(0, 25);
}

function extractTypedFilterTerms(oilInfo: OilInfo): FilterSearchGroup[] {
  const extract = (raw?: string): string[] => {
    if (!raw) return [];
    const variants: string[] = [];
    for (const part of raw.split(/[,;\/]/)) {
      const normalized = normalizeOem(part.trim());
      if (!normalized) continue;
      if (looksLikeOem(normalized)) variants.push(normalized);
      const compact = normalized.replace(/[^A-Z0-9]/g, "");
      if (compact !== normalized && looksLikeOem(compact)) variants.push(compact);
      const digitsOnly = compact.replace(/\D/g, "");
      if (digitsOnly && digitsOnly !== compact && looksLikeOem(digitsOnly)) variants.push(digitsOnly);
    }
    return [...new Set(variants)].slice(0, 6);
  };

  const groups: FilterSearchGroup[] = [
    { kind: "oil-filter", terms: extract(oilInfo.oilFilterOem) },
    { kind: "fuel-filter", terms: extract(oilInfo.fuelFilterOem) },
    { kind: "air-filter", terms: extract(oilInfo.airFilterOem) },
    { kind: "cabin-filter", terms: extract(oilInfo.cabinFilterOem) },
  ];
  return groups.filter((group) => group.terms.length > 0);
}

function dedupeLookupItems(items: MoySkladItem[]): MoySkladItem[] {
  const map = new Map<string, MoySkladItem>();
  for (const item of items) {
    const key = [
      item.lookupKind ?? "",
      item.productId ?? "",
      item.store ?? "",
      item.article ?? "",
      item.name ?? "",
    ].join("|");
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function hasText(value?: string): boolean {
  return Boolean(value && value.trim().length > 0);
}

function extractSaeViscositiesFromText(text: string): string[] {
  const matches = text.match(/\b\d{1,2}W[\s-]?\d{2}\b/gi) ?? [];
  return [...new Set(matches.map((match) => match.toUpperCase().replace(/\s+/g, "").replace(/W-?/, "W-")))];
}

function canonicalizeOilApprovalsForVehicle(decoded: VinDecoded, approvals: string[]): string[] {
  const make = (decoded.make ?? "").trim().toLowerCase();
  const year = Number.parseInt(decoded.modelYear ?? "", 10);
  return approvals.map((approval) => {
    if (make === "ford" && year >= 2012 && /WSS-M2C913-C/i.test(approval)) {
      return approval.replace(/WSS-M2C913-C/i, "WSS-M2C913-D");
    }
    return approval;
  });
}

function applyKnownOilFallbacks(decoded: VinDecoded, requirements: OilRequirements): void {
  const make = (decoded.make ?? "").trim().toLowerCase();
  const model = (decoded.model ?? "").trim().toLowerCase();
  const engine = (decoded.engineSeries ?? "").trim().toLowerCase();
  const year = Number.parseInt(decoded.modelYear ?? "", 10);

  if (make === "bmw" && /\bb47\b/i.test(decoded.engineSeries ?? "")) {
    if ((requirements.oem_approvals?.length ?? 0) === 0) requirements.oem_approvals = ["BMW LL-04"];
    if ((requirements.sae_viscosities?.length ?? 0) === 0) requirements.sae_viscosities = ["0W-30", "5W-30"];
    if ((requirements.acea?.length ?? 0) === 0) requirements.acea = ["C3"];
    if (requirements.oil_capacity_liters == null || /оценк|типичн|не подтверж|estimate|typical/i.test(requirements.source_hint ?? "")) {
      requirements.oil_capacity_liters = 5.0;
      requirements.oil_capacity_note = requirements.oil_capacity_note || "с фильтром";
    }
  }

  if (make === "ford" && model.includes("mondeo") && year >= 2014 && engine.includes("2.5l duratec")) {
    if ((requirements.oem_approvals?.length ?? 0) === 0) requirements.oem_approvals = ["Ford WSS-M2C913-D"];
    if ((requirements.sae_viscosities?.length ?? 0) === 0) requirements.sae_viscosities = ["5W-30"];
    if ((requirements.acea?.length ?? 0) === 0) requirements.acea = ["A5/B5"];
    if (requirements.oil_capacity_liters == null || /оценк|типичн|не подтверж|estimate|typical/i.test(requirements.source_hint ?? "")) {
      requirements.oil_capacity_liters = 4.6;
      requirements.oil_capacity_note = requirements.oil_capacity_note || "сервисный объём";
    }
  }

  if ((make.includes("lada") || make.includes("лада")) && /21129|ваз-21129/i.test(decoded.engineSeries ?? "")) {
    if ((requirements.sae_viscosities?.length ?? 0) === 0) requirements.sae_viscosities = ["5W-30", "5W-40"];
    if ((requirements.acea?.length ?? 0) === 0) requirements.acea = ["A3/B4"];
    if ((requirements.api?.length ?? 0) === 0) requirements.api = ["SN"];
  }

  if ((make === "audi" || make === "volkswagen" || make === "vw" || make === "skoda") && /^cncd$/i.test(decoded.engineSeries ?? "")) {
    requirements.oem_approvals = ["VW 502.00"];
    if ((requirements.sae_viscosities?.length ?? 0) === 0) requirements.sae_viscosities = ["5W-30", "5W-40"];
    requirements.acea = ["A3/B4"];
  }

  if (make === "mitsubishi" && /pajero|montero|nativa/i.test(decoded.model ?? "") && (engine === "3000" || decoded.displacementL === "3")) {
    if ((requirements.sae_viscosities?.length ?? 0) === 0) requirements.sae_viscosities = ["5W-30", "5W-40"];
    if ((requirements.acea?.length ?? 0) === 0) requirements.acea = ["A3/B4"];
    if ((requirements.api?.length ?? 0) === 0) requirements.api = ["SN"];
  }

  // Kia / Hyundai 2.2 CRDi D4HB (часто в Sorento / Santa Fe и др.) — при «пустом» ответе ИИ остаётся без ACEA/SAE.
  const engineCode = (decoded.engineSeries ?? "").toUpperCase();
  if ((make === "kia" || make === "hyundai") && engineCode.includes("D4HB")) {
    if ((requirements.sae_viscosities?.length ?? 0) === 0) requirements.sae_viscosities = ["5W-30"];
    if ((requirements.acea?.length ?? 0) === 0) requirements.acea = ["C3"];
  }
}

/** Заполнить oilInfo минимальными допусками по известным моторам, если OpenAI/веб не дали SAE/ACEA. */
function applyVehicleOilHeuristics(decoded: VinDecoded, oilInfo: OilInfo): void {
  const make = (decoded.make ?? "").trim().toLowerCase();
  const engineCode = (decoded.engineSeries ?? "").toUpperCase();
  if ((make === "kia" || make === "hyundai") && engineCode.includes("D4HB")) {
    if (!(oilInfo.sae?.length ?? 0)) oilInfo.sae = ["5W-30"];
    if (!(oilInfo.acea?.length ?? 0)) oilInfo.acea = ["C3"];
    if (!hasText(oilInfo.approval) && (oilInfo.acea?.length ?? 0) > 0) {
      oilInfo.approval = (oilInfo.acea ?? []).join(", ");
    }
  }
}

/** Разобрать строку допуска "API SN, ILSAC GF-5, ACEA C3" в api/acea/ilsac; остальное — OEM. */
function parseApprovalString(approval: string): {
  api: string[];
  acea: string[];
  ilsac: string[];
  oem: string[];
} {
  const api: string[] = [];
  const acea: string[] = [];
  const ilsac: string[] = [];
  const oem: string[] = [];
  const parts = approval.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (/^API\s+/i.test(p)) {
      const val = p.replace(/^API\s+/i, "").trim();
      if (val) api.push(val);
    } else if (/^ACEA\s+/i.test(p)) {
      const val = p.replace(/^ACEA\s+/i, "").trim();
      if (val) acea.push(val);
    } else if (/^ILSAC\s+/i.test(p)) {
      const val = p.replace(/^ILSAC\s+/i, "").trim();
      if (val) ilsac.push(val);
    } else if (/\bGF-?\d\b/i.test(p)) {
      const m = p.match(/GF-?(\d)/i);
      if (m) ilsac.push(`GF-${m[1]}`);
    } else if (/^[A-C]\d(\/\w+)?$/i.test(p) || /^[A-C]\d$/i.test(p)) {
      acea.push(p);
    } else if (/^(SN|SP|CK-4|CF|SL|SJ|CH-4)$/i.test(p.replace(/\s/g, ""))) {
      api.push(p.replace(/\s/g, ""));
    } else {
      if (p.length >= 2) oem.push(p);
    }
  }
  return { api, acea, ilsac, oem };
}

/** Собрать OilRequirements из oilInfo (для строгого подбора масел через scoreAndMatch). */
function oilInfoToRequirements(oilInfo: OilInfo): OilRequirements | null {
  const sae = oilInfo.sae ?? [];
  const aceaFromInfo = oilInfo.acea ?? [];
  const apiFromInfo = oilInfo.api ?? [];
  const ilsacFromInfo = oilInfo.ilsac ?? [];
  const parsed = oilInfo.approval ? parseApprovalString(oilInfo.approval) : null;
  let acea = aceaFromInfo.length ? aceaFromInfo : (parsed?.acea ?? []);
  // Строка вида «Допуск C3», «ACEA C3 / SAE …» не режется parseApprovalString на части — ACEA теряется,
  // а «левый» текст уходит в OEM → стратегия OEM+SAE ищет несуществующее, ACEA+SAE не создаётся.
  if (acea.length === 0 && oilInfo.approval?.trim()) {
    acea = normalizeACEA(oilInfo.approval);
  }
  const api = apiFromInfo.length ? apiFromInfo : (parsed?.api ?? []);
  const ilsac = ilsacFromInfo.length ? ilsacFromInfo : (parsed?.ilsac ?? []);
  // Важно: OEM не "достаем" из необработанной строки допуска.
  // Если OpenAI вернул только ACEA/API/ILSAC, то OEM должен считаться отсутствующим,
  // чтобы приоритеты поиска (OEM+SAE -> ACEA+SAE -> API+SAE -> ILSAC+SAE) отработали корректно.
  let oem = parsed?.oem ?? [];
  oem = oem.filter((x) => normalizeACEA(x).length === 0 && normalizeSAE(x).length === 0);
  if (sae.length === 0 && oem.length === 0 && acea.length === 0 && api.length === 0 && ilsac.length === 0) return null;
  return {
    sae_viscosities: Array.isArray(sae) ? sae : [],
    oem_approvals: oem,
    acea,
    api,
    ilsac: ilsac.length ? ilsac : undefined,
    confidence: 0.5,
  };
}

async function findFilterItems(oilInfo: OilInfo): Promise<{ items: MoySkladItem[]; error?: string }> {
  const filterGroups = extractTypedFilterTerms(oilInfo);
  if (filterGroups.length === 0) return { items: [] };

  const groupResults: Array<{ items: MoySkladItem[]; error?: string }> = [];
  for (const group of filterGroups) {
    groupResults.push(await searchMoySkladProductsByTerms(group.terms, group.kind));
  }

  const items = dedupeLookupItems(groupResults.flatMap((group) => group.items));
  const error = groupResults.map((group) => group.error).find(Boolean);
  console.log("[lookup] filters groups=", filterGroups.length, "items=", items.length);
  return { items, error };
}

function buildOilSearchStrategies(requirements: OilRequirements): Array<{ label: string; req: OilRequirements }> {
  const hasOem = (requirements.oem_approvals?.length ?? 0) > 0;
  const hasSae = (requirements.sae_viscosities?.length ?? 0) > 0;
  if (!hasSae) return [];

  const strategies: Array<{ label: string; req: OilRequirements }> = [];

  // Сначала пробуем OEM+SAE, но не «глотаем» ACEA/API/ILSAC: в ответе OpenAI часто бывает
  // и марочный допуск, и ACEA C3 — в карточках МойСклад C3 может быть только в поле ACEA.
  // Раньше при hasOem выполнялась только эта ветка, из‑за чего C3 в UI был, а матчинг масла — пустой.
  if (hasOem) {
    strategies.push({
      label: "OEM+SAE",
      req: {
        ...requirements,
        acea: [],
        api: [],
        ilsac: [],
      },
    });
  }

  if ((requirements.acea?.length ?? 0) > 0) {
    strategies.push({
      label: "ACEA+SAE",
      req: {
        ...requirements,
        oem_approvals: [],
        api: [],
        ilsac: [],
      },
    });
  }
  if ((requirements.api?.length ?? 0) > 0) {
    strategies.push({
      label: "API+SAE",
      req: {
        ...requirements,
        oem_approvals: [],
        acea: [],
        ilsac: [],
      },
    });
  }
  if ((requirements.ilsac?.length ?? 0) > 0) {
    strategies.push({
      label: "ILSAC+SAE",
      req: {
        ...requirements,
        oem_approvals: [],
        acea: [],
        api: [],
      },
    });
  }

  // Крайний случай: марка/мусор в OEM, ACEA не распарсился — хотя бы вязкость (иначе ноль масел).
  strategies.push({
    label: "SAE-only",
    req: {
      ...requirements,
      oem_approvals: [],
      acea: [],
      api: [],
      ilsac: [],
    },
  });

  return strategies;
}

async function findOilItems(oilInfo: OilInfo): Promise<{ items: MoySkladItem[]; error?: string }> {
  const requirements = oilInfoToRequirements(oilInfo);
  if (!requirements) return { items: [] };

  const strategies = buildOilSearchStrategies(requirements);
  if (strategies.length === 0) {
    return { items: [], error: "Для подбора масел по VIN не найдена вязкость SAE." };
  }

  try {
    let firstNonEmptyItems: MoySkladItem[] | null = null;
    for (const strategy of strategies) {
      // Используем тот же точечный поиск по допускам, что и /api/oil-search.
      // Полный скан каталога тяжёлый и иногда возвращал 0, после чего UI писал "масла нет".
      let candidateOils = await fetchOilCandidatesByRequirements(strategy.req);
      if (candidateOils.length === 0) {
        candidateOils = await fetchOilProductsFromMoySklad(1000);
      }
      const { recommended, alternatives } = scoreAndMatch(strategy.req, candidateOils, 500, 500);
      const oilProducts = [...recommended, ...alternatives].map((r) => ({
        id: r.product.id,
        name: r.product.name,
        article: r.product.article,
        price: r.product.price,
        currency: r.product.currency,
        volumeLiters: r.product.volume_liters,
        imageHref: r.product.imageHref,
      }));

      const items = dedupeLookupItems(await getStockItemsForProducts(oilProducts));
      const availableItems = items.filter((item) => item.quantity > 0);
      console.log(
        `[lookup] oils strategy ${strategy.label}: candidates=${candidateOils.length}, matched=${oilProducts.length}, items=${items.length}, available=${availableItems.length}`
      );
      if (availableItems.length > 0) return { items };
      // Запоминаем нулевую выдачу, но не останавливаемся: следующая стратегия может найти наличие.
      if (items.length > 0 && !firstNonEmptyItems) firstNonEmptyItems = items;
    }

    // Нет ни одной позиции в наличии ни по одной стратегии — отдаём первый список под заказ.
    return firstNonEmptyItems ? { items: firstNonEmptyItems } : { items: [] };
  } catch (e) {
    console.warn("[lookup] oil match:", e);
    return { items: [], error: "Ошибка подбора масел по допускам." };
  }
}

type SearchHit = { title: string; link: string; snippet: string };

async function searchWeb(query: string, num = 10): Promise<SearchHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { organic?: { title?: string; link?: string; snippet?: string }[] };
    return (data.organic ?? []).map((o) => ({
      title: o.title ?? "",
      link: o.link ?? "",
      snippet: o.snippet ?? "",
    }));
  } catch {
    return [];
  }
}

/** Поиск только для допуска масла и заправочного объёма (OpenAI). Фильтры берём из Parts API. */
async function collectOilApprovalSearch(decoded: VinDecoded): Promise<string> {
  const make = decoded.make;
  const model = decoded.model;
  const year = decoded.modelYear;
  const mod = decoded.modification || decoded.trim || "";
  const engine = decoded.engineSeries || "";

  const base = [make, model, year, mod].filter(Boolean).join(" ");
  const baseEngine = [make, model, year, mod, engine].filter(Boolean).join(" ");

  const queries = [
    `${baseEngine} engine oil specification approved`,
    `${baseEngine} Ford WSS-M2C engine oil`,
    `${base} допуск масла моторное`,
    `${baseEngine} oil capacity liters fill`,
    `${baseEngine} заправочный объём масла л`,
    `${make} ${model} ${year} ${mod} oil specification capacity`,
  ];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const q of queries) {
    if (!q.trim()) continue;
    const hits = await searchWeb(q, 10);
    for (const h of hits) {
      const text = `${h.title} ${h.snippet}`.trim();
      const key = text.slice(0, 150);
      if (key && !seen.has(key)) {
        seen.add(key);
        parts.push(`[${h.title || h.link}]\n${h.snippet || ""}`);
      }
    }
  }
  return parts.slice(0, 15).join("\n\n");
}

/** Полные данные API Cloud для OpenAI: весь отчёт по автомобилю (reports[0]) в JSON. */
function buildVehicleContextForOpenAI(decoded: VinDecoded): string {
  const raw = decoded.rawReport;
  if (raw && typeof raw === "object") {
    return (
      "Данные от VIN-декодера API Cloud (полный отчёт по автомобилю):\n\n" +
      JSON.stringify(raw, null, 2)
    );
  }
  const power =
    decoded.enginePowerPS != null
      ? `${Math.floor(decoded.enginePowerPS)} л.с.`
      : "";
  const volume = decoded.displacementL ? `${decoded.displacementL} л` : "";
  const fuel = decoded.fuelTypePrimary ? `Топливо: ${decoded.fuelTypePrimary}` : "";
  const lines = [
    `Марка: ${decoded.make}`,
    `Модель: ${decoded.model}`,
    `Год: ${decoded.modelYear}`,
    decoded.generation ? `Поколение/код кузова: ${decoded.generation}` : "",
    decoded.modification || decoded.trim ? `Модификация: ${decoded.modification || decoded.trim}` : "",
    decoded.engineSeries ? `Двигатель (код): ${decoded.engineSeries}` : "",
    volume ? `Объём двигателя: ${volume}` : "",
    fuel,
    power ? `Мощность: ${power}` : "",
  ].filter(Boolean);
  return "Данные автомобиля:\n" + lines.join("\n");
}

/** Один запрос к OpenAI: только допуск масла или заправочный объём (фильтры — из Parts API). */
async function askOpenAIOilSpec(
  openai: OpenAI,
  decoded: VinDecoded,
  type: "approval" | "volume",
  searchBlock: string
): Promise<string> {
  const vehicleContext = buildVehicleContextForOpenAI(decoded);
  const catalogRule = `Ниже даны данные автомобиля и фрагменты каталогов. Извлеки ОДНО значение для ЭТОГО автомобиля (модификация, двигатель engineSeries).`;

  const system =
    type === "approval"
      ? `${catalogRule} Нужен допуск масла: в первую очередь OEM-спецификация производителя (например Ford WSS-M2C...), затем SAE/ACEA/API если они явно указаны. Ответь одной строкой: Допуск масла: [значение] или Допуск масла: не найдено`
      : `${catalogRule} Нужен заправочный объём моторного масла в литрах (число, например 5.2). Ищи: oil capacity, fill capacity, заправочный объём. Ответь: Заправочный объём: [число] л или Заправочный объём: не найдено`;

  const userContent = [vehicleContext, "", "--- Фрагменты каталогов ---\n" + (searchBlock || "(нет результатов)")].join("\n");

  const model = process.env.OPENAI_OIL_MODEL?.trim() || "gpt-4o-mini";
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    max_completion_tokens: 220,
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  const colonIdx = text.indexOf(":");
  return colonIdx >= 0 ? text.slice(colonIdx + 1).trim() : text.trim();
}

/** Фильтры (OEM) и расшифровка авто — Parts Catalogs API. OpenAI отключён. */
async function getVehicleInfo(vin: string, _decoded: VinDecoded | null): Promise<{
  oilInfo: OilInfo | null;
  decoded: VinDecoded | null;
}> {
  const cleanVin = vin.replace(/\s/g, "").toUpperCase();
  console.log("[lookup] VIN=", cleanVin);
  const filters = process.env.PARTS_CATALOGS_API_KEY?.trim()
    ? await getFiltersFromPartsCatalogs(cleanVin)
    : {};
  console.log("[lookup] Фильтры:", filters);

  const rawText = [
    `Масляный фильтр OEM: ${filters.oilFilterOem ?? ""}`,
    `Топливный фильтр OEM: ${filters.fuelFilterOem ?? ""}`,
    `Воздушный фильтр OEM: ${filters.airFilterOem ?? ""}`,
    `Салонный фильтр OEM: ${filters.cabinFilterOem ?? ""}`,
  ].join("\n");

  const hasVehicle =
    (filters.make ?? "").trim() || (filters.model ?? "").trim() || (filters.modelYear ?? "").trim();
  const decoded: VinDecoded | null = hasVehicle
    ? {
        make: (filters.make ?? "").trim(),
        model: (filters.model ?? "").trim(),
        modelYear: (filters.modelYear ?? "").trim(),
        engineCylinders: "",
        displacementL: (filters.displacementL ?? "").trim(),
        fuelTypePrimary: (filters.fuelTypePrimary ?? "").trim(),
        bodyClass: (filters.bodyClass ?? "").trim(),
        modification: (filters.modification ?? "").trim(),
        engineSeries: (filters.engineSeries ?? "").trim(),
        generation: (filters.generation ?? "").trim(),
        market: (filters.market ?? "").trim(),
        steering: (filters.steering ?? "").trim(),
        gearType: (filters.gearType ?? "").trim(),
      }
    : null;

  const hasFilters = Boolean(
    filters.oilFilterOem || filters.fuelFilterOem || filters.airFilterOem || filters.cabinFilterOem
  );
  if (!hasFilters && !hasUsefulDecoded(decoded)) {
    return { oilInfo: null, decoded: null };
  }

  const oilInfo: OilInfo = {
    approval: "",
    fillVolumeLiters: "",
    oilFilterOem: filters.oilFilterOem,
    fuelFilterOem: filters.fuelFilterOem,
    airFilterOem: filters.airFilterOem,
    cabinFilterOem: filters.cabinFilterOem,
    rawText,
  };
  oilInfo.transmission = inferTransmissionInfo(decoded);

  return { oilInfo, decoded };
}

export async function POST(request: NextRequest) {
  const lookupStartedAt = performance.now();
  const timings: Record<string, number> = {};
  const markTiming = (name: string, startedAt: number) => {
    timings[name] = Math.round(performance.now() - startedAt);
  };
  try {
    const { vin, vehicleOverrides } = await request.json();
    if (!vin || typeof vin !== "string") {
      return NextResponse.json(
        { error: "Укажите VIN" },
        { status: 400 }
      );
    }
    const overrides =
      vehicleOverrides && typeof vehicleOverrides === "object"
        ? (vehicleOverrides as { displacementL?: unknown; enginePowerPS?: unknown })
        : {};
    const overrideDisplacementL = typeof overrides.displacementL === "string" ? overrides.displacementL.trim() : "";
    const overrideEnginePowerPS =
      typeof overrides.enginePowerPS === "string"
        ? Number.parseFloat(overrides.enginePowerPS.replace(",", "."))
        : typeof overrides.enginePowerPS === "number"
          ? overrides.enginePowerPS
          : undefined;
    const hasVehicleOverrides =
      Boolean(overrideDisplacementL) ||
      (typeof overrideEnginePowerPS === "number" && Number.isFinite(overrideEnginePowerPS) && overrideEnginePowerPS > 0);

    const result: LookupResult = {
      vin: vin.replace(/\s/g, "").toUpperCase(),
      decoded: null,
      oilInfo: null,
      moySkladItems: [],
    };

    const cached = hasVehicleOverrides ? null : getCachedLookupResult(result.vin);
    if (cached) {
      return NextResponse.json(cached);
    }

    console.log("[lookup] POST start vin=", result.vin);
    let usedPersistentCache = false;
    try {
      const cacheStartedAt = performance.now();
      const persisted = hasVehicleOverrides ? null : await getVinLookupCache(result.vin);
      markTiming("vinCacheReadMs", cacheStartedAt);
      if (persisted && hasUsefulLookupPayload(persisted)) {
        usedPersistentCache = true;
        result.oilInfo = persisted.oilInfo;
        result.decoded = persisted.decoded;
        result.openaiError = persisted.openaiError;
        console.log("[lookup] VIN cache hit", result.vin);
      } else {
        const vehicleStartedAt = performance.now();
        const vehicleResult = await getVehicleInfo(result.vin, null);
        markTiming("vehicleAndPartsMs", vehicleStartedAt);
        result.oilInfo = vehicleResult.oilInfo;
        result.decoded = vehicleResult.decoded;
        if (result.decoded && hasVehicleOverrides) {
          if (overrideDisplacementL) result.decoded.displacementL = overrideDisplacementL;
          if (typeof overrideEnginePowerPS === "number" && Number.isFinite(overrideEnginePowerPS) && overrideEnginePowerPS > 0) {
            result.decoded.enginePowerPS = overrideEnginePowerPS;
          }
        }
        console.log("[lookup] POST oilInfo:", result.oilInfo ? "ok" : "null", result.oilInfo ? { oil: result.oilInfo.oilFilterOem, fuel: result.oilInfo.fuelFilterOem, air: result.oilInfo.airFilterOem, cabin: result.oilInfo.cabinFilterOem } : "");
        if (result.decoded) console.log("[lookup] POST decoded:", result.decoded.make, result.decoded.model, result.decoded.modelYear);

        if (result.oilInfo && result.decoded && process.env.OPENAI_API_KEY?.trim()) {
          const hasDecoded = (result.decoded.make ?? result.decoded.model ?? result.decoded.modelYear ?? "").trim();
          if (hasDecoded) {
            try {
              const oilRequirementsStartedAt = performance.now();
              const openai = getOpenAI();
              if (openai) {
                const req = await getOilRequirementsFromOpenAI(openai, {
                  make: result.decoded.make,
                  model: result.decoded.model,
                  year: result.decoded.modelYear,
                  engine: result.decoded.engineSeries,
                  trim: result.decoded.modification || result.decoded.generation,
                  series: result.decoded.generation,
                  market: result.decoded.market,
                  vin: result.vin,
                  hints: [
                    result.decoded.bodyClass ? `Кузов: ${result.decoded.bodyClass}` : "",
                    result.decoded.gearType ? `КПП: ${result.decoded.gearType}` : "",
                    result.decoded.steering ? `Руль: ${result.decoded.steering}` : "",
                    result.decoded.displacementL ? `Объём двигателя: ${result.decoded.displacementL} л` : "",
                    result.decoded.enginePowerPS ? `Мощность: ${Math.round(result.decoded.enginePowerPS)} л.с.` : "",
                    result.decoded.fuelTypePrimary ? `Топливо: ${result.decoded.fuelTypePrimary}` : "",
                    result.oilInfo.oilFilterOem ? `OEM масляного фильтра: ${result.oilInfo.oilFilterOem}` : "",
                    result.oilInfo.fuelFilterOem ? `OEM топливного фильтра: ${result.oilInfo.fuelFilterOem}` : "",
                    result.oilInfo.airFilterOem ? `OEM воздушного фильтра: ${result.oilInfo.airFilterOem}` : "",
                    result.oilInfo.cabinFilterOem ? `OEM салонного фильтра: ${result.oilInfo.cabinFilterOem}` : "",
                  ].filter(Boolean),
                });
                let oilSearchBlock: string | null = null;
                if ((req.oem_approvals?.length ?? 0) === 0 && (req.acea?.length ?? 0) === 0) {
                  oilSearchBlock = await collectOilApprovalSearch(result.decoded);
                  if (oilSearchBlock) {
                    const fallbackApproval = await askOpenAIOilSpec(openai, result.decoded, "approval", oilSearchBlock);
                    if (fallbackApproval && !/не найдено|not found/i.test(fallbackApproval)) {
                      const parsed = parseApprovalString(fallbackApproval);
                      const sae = extractSaeViscositiesFromText(fallbackApproval);
                      if (parsed.oem.length) req.oem_approvals = parsed.oem;
                      if (parsed.acea.length) req.acea = parsed.acea;
                      if (parsed.api.length) req.api = parsed.api;
                      if (parsed.ilsac.length) req.ilsac = parsed.ilsac;
                      if (sae.length) req.sae_viscosities = sae;
                      console.log("[lookup] OpenAI oil fallback approval:", fallbackApproval);
                    }
                  }
                }
                if (/оценк|типичн|не подтверж|not confirm|estimate|typical/i.test(req.source_hint ?? "")) {
                  oilSearchBlock ??= await collectOilApprovalSearch(result.decoded);
                  if (oilSearchBlock) {
                    const fallbackVolume = await askOpenAIOilSpec(openai, result.decoded, "volume", oilSearchBlock);
                    const volume = Number.parseFloat(fallbackVolume.replace(",", ".").replace(/[^\d.]/g, ""));
                    if (Number.isFinite(volume) && volume > 0) {
                      req.oil_capacity_liters = volume;
                      console.log("[lookup] OpenAI oil fallback volume:", fallbackVolume);
                    }
                  }
                }
                applyKnownOilFallbacks(result.decoded, req);
                req.oem_approvals = canonicalizeOilApprovalsForVehicle(result.decoded, req.oem_approvals ?? []);
                if (req.oem_approvals?.length || req.acea?.length) {
                  result.oilInfo.approval = (req.oem_approvals ?? []).join(", ") || (req.acea ?? []).join(", ") || "";
                }
                if (req.oil_capacity_liters != null && req.oil_capacity_liters > 0) {
                  result.oilInfo.fillVolumeLiters = String(req.oil_capacity_liters);
                }
                result.oilInfo.sae = req.sae_viscosities ?? [];
                result.oilInfo.acea = req.acea ?? [];
                result.oilInfo.api = req.api ?? [];
                result.oilInfo.ilsac = req.ilsac ?? [];
                console.log("[lookup] OpenAI oil: approval=", result.oilInfo.approval || "—", "volume=", result.oilInfo.fillVolumeLiters || "—", "л");
              }
              markTiming("oilRequirementsMs", oilRequirementsStartedAt);
            } catch (e) {
              const err = e as { message?: string; status?: number; code?: string; error?: { message?: string; code?: string } };
              const msg = err?.error?.message ?? err?.message ?? String(e);
              const code = err?.error?.code ?? err?.code;
              const status = err?.status;
              console.error("[lookup] OpenAI oil requirements error:", msg, code != null ? `code=${code}` : "", status != null ? `status=${status}` : "");
              if (process.env.NODE_ENV === "development" && e) console.error("[lookup] OpenAI error detail:", e);
            }
          }
        }
      }
    } catch (e: unknown) {
      const err = e as { message?: string; error?: { message?: string } };
      result.openaiError =
        err?.error?.message ?? err?.message ?? (typeof e === "string" ? e : "Ошибка при получении рекомендаций");
    }

    if (result.oilInfo && result.decoded) {
      applyVehicleOilHeuristics(result.decoded, result.oilInfo);
    }

    if (!usedPersistentCache && !hasVehicleOverrides && hasUsefulLookupPayload(result)) {
      const cacheWriteStartedAt = performance.now();
      await setVinLookupCache(result.vin, {
        decoded: result.decoded,
        oilInfo: result.oilInfo,
        openaiError: result.openaiError,
      });
      markTiming("vinCacheWriteMs", cacheWriteStartedAt);
    }

    if (result.oilInfo) {
      const filterStartedAt = performance.now();
      const filterPromise = findFilterItems(result.oilInfo).finally(() => markTiming("moyskladFiltersMs", filterStartedAt));
      const oilStartedAt = performance.now();
      const oilPromise = findOilItems(result.oilInfo).finally(() => markTiming("moyskladOilsMs", oilStartedAt));
      const [filterOutcome, oilOutcome] = await Promise.all([filterPromise, oilPromise]);

      const filterItems = filterOutcome.items;
      const oilItems = oilOutcome.items;
      if (filterOutcome.error) result.moySkladError = filterOutcome.error;
      if (!result.moySkladError && oilOutcome.error) result.moySkladError = oilOutcome.error;

      result.moySkladItems = [...filterItems, ...oilItems];
      if (result.moySkladItems.length === 0 && !result.moySkladError) {
        const hasFilterOem = Boolean(
          result.oilInfo.oilFilterOem ||
            result.oilInfo.fuelFilterOem ||
            result.oilInfo.airFilterOem ||
            result.oilInfo.cabinFilterOem
        );
        const hasOilParams = Boolean(
          hasText(result.oilInfo.approval) ||
            hasText(result.oilInfo.fillVolumeLiters) ||
            (result.oilInfo.sae?.length ?? 0) > 0 ||
            (result.oilInfo.acea?.length ?? 0) > 0 ||
            (result.oilInfo.api?.length ?? 0) > 0 ||
            (result.oilInfo.ilsac?.length ?? 0) > 0
        );
        result.moySkladError = hasFilterOem || hasOilParams
          ? "По этим параметрам в МойСклад позиций не найдено."
          : "Не удалось определить параметры масла/фильтров по VIN. Проверьте VIN или полноту данных в каталогах.";
      }
    } else {
      result.moySkladError = "Не удалось определить параметры масла/фильтров по VIN. Проверьте VIN или полноту данных в каталогах.";
    }

    setCachedLookupResult(result.vin, result);
    timings.totalMs = Math.round(performance.now() - lookupStartedAt);
    console.log("[lookup] timings", JSON.stringify(timings));
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
