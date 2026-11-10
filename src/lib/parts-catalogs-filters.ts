import { partsCatalogsRequest } from "./parts-catalogs";

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

type PartItem = { number?: string; name?: string; description?: string; notice?: string; groupPath?: string };
type CollectedGroup = { item: GroupItem; pathNames: string[] };

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
export async function getFiltersFromPartsCatalogs(vin: string, options?: { strictVin?: boolean; signal?: AbortSignal }): Promise<{
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
  if (options?.strictVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) return {};
  if (cleanVin.length < 8) {
    console.log("[Parts Catalogs] VIN слишком короткий:", cleanVin);
    return {};
  }


  const { status, data: carData } = await partsCatalogsRequest("/car/info", { q: cleanVin }, options?.signal);
  if (status !== 200 || !carData) {
    console.log("[Parts Catalogs] car/info status=", status);
    return {};
  }

  const items = getCarInfoItems(carData);
  const first = items[0] as CarInfoItem | undefined;
  if (options?.strictVin && (items.length !== 1 || (first?.vin && first.vin.replace(/\s/g, "").toUpperCase() !== cleanVin))) return {};
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
    const { status: st, data } = await partsCatalogsRequest(`/catalogs/${catalogId}/groups2/`, params, options?.signal);
    if (st !== 200) return [];
    if (Array.isArray(data)) return data as GroupItem[];
    const o = data as Record<string, unknown>;
    return (o.items ?? o.groups ?? []) as GroupItem[];
  };

  const getParts = async (groupId: string): Promise<PartItem[]> => {
    const params: Record<string, string> = { carId, groupId };
    if (criteria) params.criteria = criteria;
    const { status: st, data } = await partsCatalogsRequest(`/catalogs/${catalogId}/parts2`, params, options?.signal);
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

  /** Собирает до maxCount уникальных OEM-номеров (чтобы искать в локальном каталоге по нескольким вариантам). */
  const uniqueNumbers = (parts: PartItem[], maxCount: number): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      if (out.length >= maxCount) break;
      const raw = (p.number ?? (options?.strictVin ? "" : p.name) ?? "").trim().toUpperCase().replace(/\s+/g, "");
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
