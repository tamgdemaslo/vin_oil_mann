import OpenAI from "openai";
import { moyskladFetch, getMoySkladAuthHeader, MOYSKLAD_BASE } from "@/lib/moysklad";
import { getOilLineBaseName, parsePackVolumeLitersFromOilName } from "@/lib/oil-pack-volume";
import { normalizeSAE, normalizeOEM, normalizeACEA, normalizeAPI } from "@/lib/oil-normalizer";
import type {
  VinDecodeResponse,
  OilRequirements,
  OilProduct,
  OilRecommendationItem,
} from "@/types/oil";

const CACHE_DAYS = Math.min(30, Math.max(1, parseInt(process.env.OIL_CACHE_DAYS ?? "7", 10) || 7));
const CACHE_TTL_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;
const cache = new Map<string, { requirements: OilRequirements; at: number }>();
const OIL_PRODUCTS_CACHE_TTL_MS = Math.max(
  60_000,
  parseInt(process.env.MOYSKLAD_LOOKUP_OIL_CACHE_MS ?? "1800000", 10) || 1_800_000
);
let oilProductsCache: { at: number; products: OilProduct[] } | null = null;
let oilProductsInFlight: Promise<OilProduct[]> | null = null;
const oilCandidatesCache = new Map<string, { at: number; products: OilProduct[] }>();

function getCacheKey(vin: string, market?: string): string {
  return `${vin.toUpperCase()}|${(market ?? "").trim()}`;
}

export function getCachedRequirements(vin: string, market?: string): OilRequirements | null {
  const key = getCacheKey(vin, market);
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.requirements;
}

export function setCachedRequirements(vin: string, market: string | undefined, requirements: OilRequirements): void {
  cache.set(getCacheKey(vin, market), { requirements, at: Date.now() });
}

/** OpenAI: структурированный ответ по требованиям масла (SAE, OEM, ACEA, API, объём). */
export async function getOilRequirementsFromOpenAI(
  openai: OpenAI,
  decoded: VinDecodeResponse
): Promise<OilRequirements> {
  const vehicle = [
    decoded.vin && `VIN: ${decoded.vin}`,
    decoded.make && `Марка: ${decoded.make}`,
    decoded.model && `Модель: ${decoded.model}`,
    decoded.year && `Год: ${decoded.year}`,
    decoded.engine && `Двигатель: ${decoded.engine}`,
    decoded.trim && `Модификация: ${decoded.trim}`,
    decoded.series && `Серия/поколение: ${decoded.series}`,
    decoded.market && `Рынок: ${decoded.market}`,
    decoded.region && `Регион: ${decoded.region}`,
    ...(decoded.hints ?? []).map((hint) => `Подсказка: ${hint}`),
  ]
    .filter(Boolean)
    .join("\n");

  const model = process.env.OPENAI_OIL_MODEL?.trim() || "gpt-4o-mini";
  let completion: Awaited<ReturnType<typeof openai.chat.completions.create>>;
  try {
    completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `Ты — эксперт по моторным маслам. По данным автомобиля верни JSON с требованиями к маслу.
Работай как извлекатель технических фактов, а не как продавец масла.
Используй конкретные поля двигателя, модификации, года, рынка и поколения. Не обобщай до всей модели, если указан двигатель.
Не объединяй допуски, которые относятся к разным двигателям, рынкам или условиям эксплуатации.
Для OEM-допусков ищи именно спецификации производителя: Ford WSS-M2C..., BMW LL-..., VW 50x.xx, MB 229.x, GM dexos и т.п.
Для Ford не ограничивайся API/ACEA, если по двигателю и году можно определить Ford WSS-спецификацию.
Если точный допуск или объём нельзя определить для указанного двигателя, верни пустой массив/null и понизь confidence.
Формат ответа (только валидный JSON, без markdown):
{
  "oil_capacity_liters": число или null,
  "oil_capacity_note": "с фильтром" или "без фильтра" или "",
  "sae_viscosities": ["5W-30"] или ["0W-20","5W-30"] — массив допустимых вязкостей SAE,
  "oem_approvals": ["VW 504 00","VW 507 00"] — допуски производителей,
  "acea": ["C3"],
  "api": ["SN"],
  "ilsac": ["GF-5","GF-6"] или [] — если ILSAC указано отдельно от API,
  "confidence": 0.0-1.0,
  "source_hint": "кратко на чём основано"
}
SAE всегда в формате XW-YY (например 5W-30). OEM — канонические обозначения (VW 504 00, MB 229.5, BMW LL-04, dexos2 и т.д.).`,
        },
        { role: "user", content: `Данные автомобиля:\n${vehicle || "(только VIN)"}\n\nВерни JSON с требованиями к моторному маслу.` },
      ],
response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });
  } catch (e) {
    const err = e as { message?: string; status?: number; code?: string; error?: { message?: string; code?: string } };
    console.error("[oil-recommendations] OpenAI API error:", err?.error?.message ?? err?.message, "model=" + model, err?.status != null ? "status=" + err.status : "", err?.error?.code ?? err?.code ?? "");
    throw e;
  }

  const text = completion.choices[0]?.message?.content?.trim() ?? "{}";
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const parsedIlsac = parsed["ilsac"];
    let oilCapacityLiters =
      typeof parsed.oil_capacity_liters === "number" && Number.isFinite(parsed.oil_capacity_liters)
        ? parsed.oil_capacity_liters
        : undefined;
    let oilCapacityNote = typeof parsed.oil_capacity_note === "string" ? parsed.oil_capacity_note : undefined;
    let sourceHint = typeof parsed.source_hint === "string" ? parsed.source_hint : undefined;

    if (oilCapacityLiters == null) {
      const volumeAttempt = await getOilCapacityFallbackFromOpenAI(openai, model, vehicle);
      if (volumeAttempt.oil_capacity_liters != null && volumeAttempt.oil_capacity_liters > 0) {
        oilCapacityLiters = volumeAttempt.oil_capacity_liters;
        oilCapacityNote = volumeAttempt.oil_capacity_note ?? oilCapacityNote;
        sourceHint = [sourceHint, volumeAttempt.source_hint].filter(Boolean).join(" | ");
      }
    }
    if (process.env.NODE_ENV === "development") {
      console.log("[oil-recommendations] OpenAI raw:", JSON.stringify({
        oil_capacity_liters: oilCapacityLiters,
        oem_approvals: parsed.oem_approvals,
        acea: parsed.acea,
        sae_viscosities: parsed.sae_viscosities,
        source_hint: sourceHint,
      }));
    }
                return {
                  oil_capacity_liters: oilCapacityLiters,
                  oil_capacity_note: oilCapacityNote,
                  sae_viscosities: Array.isArray(parsed.sae_viscosities)
                    ? (parsed.sae_viscosities as string[]).filter((s) => typeof s === "string")
                    : [],
                  oem_approvals: Array.isArray(parsed.oem_approvals)
                    ? (parsed.oem_approvals as string[]).filter((s) => typeof s === "string")
                    : [],
                  acea: Array.isArray(parsed.acea) ? (parsed.acea as string[]).filter((s) => typeof s === "string") : [],
                  api: Array.isArray(parsed.api) ? (parsed.api as string[]).filter((s) => typeof s === "string") : [],
                  ilsac: Array.isArray(parsedIlsac)
                    ? (parsedIlsac as string[]).filter((s) => typeof s === "string")
                    : undefined,
                  confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
                  source_hint: sourceHint,
                };
  } catch {
    return {
      sae_viscosities: [],
      oem_approvals: [],
      acea: [],
      api: [],
                  ilsac: undefined,
      confidence: 0,
      source_hint: "OpenAI ответ не распознан",
    };
  }
}

async function getOilCapacityFallbackFromOpenAI(
  openai: OpenAI,
  model: string,
  vehicle: string
): Promise<Pick<OilRequirements, "oil_capacity_liters" | "oil_capacity_note" | "source_hint">> {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `Ты определяешь только заправочный объём моторного масла.
Верни только JSON:
{
  "oil_capacity_liters": число или null,
  "oil_capacity_note": "с фильтром" или "без фильтра" или "",
  "source_hint": "кратко на чем основана оценка"
}
Если точный объем недоступен, но есть наиболее вероятный сервисный объем для этой модели/двигателя, верни его как best-effort оценку, а в source_hint явно напиши, что это оценка.`,
      },
      {
        role: "user",
        content: `Определи только заправочный объем моторного масла.\n\n${vehicle || "(нет данных)"}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2048,
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? "{}";
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const oilCapacityLiters =
      typeof parsed.oil_capacity_liters === "number" && Number.isFinite(parsed.oil_capacity_liters)
        ? parsed.oil_capacity_liters
        : undefined;
    return {
      oil_capacity_liters: oilCapacityLiters,
      oil_capacity_note: typeof parsed.oil_capacity_note === "string" ? parsed.oil_capacity_note : undefined,
      source_hint: typeof parsed.source_hint === "string" ? parsed.source_hint : undefined,
    };
  } catch {
    return {};
  }
}

/** ID доп. полей товара МойСклад для масел (задаются в .env). */
const MOYSKLAD_ATTR_SAE = process.env.MOYSKLAD_ATTR_SAE ?? "";
const MOYSKLAD_ATTR_OEM = process.env.MOYSKLAD_ATTR_OEM ?? "";
const MOYSKLAD_ATTR_ACEA = process.env.MOYSKLAD_ATTR_ACEA ?? "";
const MOYSKLAD_ATTR_API = process.env.MOYSKLAD_ATTR_API ?? "";
const MOYSKLAD_ATTR_ILSAC = process.env.MOYSKLAD_ATTR_ILSAC ?? "";
const MOYSKLAD_ATTR_VOLUME = process.env.MOYSKLAD_ATTR_VOLUME ?? "";
const MOYSKLAD_ATTR_CATEGORY = process.env.MOYSKLAD_ATTR_CATEGORY ?? "";

type ProductRow = {
  id: string;
  name: string;
  article?: string;
  meta?: { href: string };
  salePrices?: { value: number; currency?: { name?: string } }[];
  attributes?: { id: string; meta?: { href?: string }; value: string }[];
  images?: {
    rows?: Array<{
      tiny?: { href?: string };
      miniature?: { href?: string };
      meta?: { href?: string };
    }>;
  };
};

function getFirstImageHref(row: ProductRow): string | undefined {
  const first = row.images?.rows?.[0];
  return first?.tiny?.href ?? first?.miniature?.href ?? first?.meta?.href;
}

function mergeUnique(values: string[][]): string[] {
  return [...new Set(values.flat().filter(Boolean))];
}

function enrichOilLineRequirements(oils: OilProduct[]): OilProduct[] {
  const byBase = new Map<string, OilProduct[]>();
  for (const oil of oils) {
    const base = getOilLineBaseName(oil.name, oil.volume_liters).toLowerCase();
    const list = byBase.get(base);
    if (list) list.push(oil);
    else byBase.set(base, [oil]);
  }

  for (const group of byBase.values()) {
    if (group.length < 2) continue;
    const merged = {
      sae: mergeUnique(group.map((oil) => oil.requirements_norm.sae)),
      oem: mergeUnique(group.map((oil) => oil.requirements_norm.oem)),
      acea: mergeUnique(group.map((oil) => oil.requirements_norm.acea)),
      api: mergeUnique(group.map((oil) => oil.requirements_norm.api)),
      ilsac: mergeUnique(group.map((oil) => oil.requirements_norm.ilsac)),
    };
    for (const oil of group) oil.requirements_norm = merged;
  }

  return oils;
}

function cloneOilProducts(products: OilProduct[]): OilProduct[] {
  return products.map((product) => ({
    ...product,
    meta: { ...product.meta },
    requirements_norm: {
      sae: [...product.requirements_norm.sae],
      oem: [...product.requirements_norm.oem],
      acea: [...product.requirements_norm.acea],
      api: [...product.requirements_norm.api],
      ilsac: [...product.requirements_norm.ilsac],
    },
  }));
}

function getCachedOilProductsSnapshot(): OilProduct[] | null {
  if (!oilProductsCache || Date.now() - oilProductsCache.at > OIL_PRODUCTS_CACHE_TTL_MS) return null;
  return cloneOilProducts(oilProductsCache.products);
}

export function warmOilProductsCache(): Promise<OilProduct[]> {
  return fetchOilProductsFromMoySklad(1000, { forceRefresh: true });
}

/** Загрузить товары категории «масло» из МойСклад с полями SAE, OEM, ACEA, API, объём. */
export async function fetchOilProductsFromMoySklad(
  limit = 200,
  options?: { forceRefresh?: boolean }
): Promise<OilProduct[]> {
  const cached = options?.forceRefresh ? null : getCachedOilProductsSnapshot();
  if (cached) return cached;
  if (oilProductsInFlight) return cloneOilProducts(await oilProductsInFlight);

  oilProductsInFlight = loadOilProductsFromMoySklad(limit).finally(() => {
    oilProductsInFlight = null;
  });
  const products = await oilProductsInFlight;
  oilProductsCache = { at: Date.now(), products: cloneOilProducts(products) };
  return cloneOilProducts(products);
}

async function loadOilProductsFromMoySklad(limit = 200): Promise<OilProduct[]> {
  const pageLimit = Math.min(1000, Math.max(100, limit));
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;
  const rows: ProductRow[] = [];

  while (offset < size) {
    const res = await moyskladFetch<{ meta?: { size?: number; limit?: number; offset?: number }; rows?: ProductRow[] }>(
      `/entity/product?limit=${pageLimit}&offset=${offset}&expand=attributes,images`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      console.warn("[oil-recommendations] MoySklad product list failed:", res.error);
      return [];
    }

    const chunk = res.data.rows ?? [];
    rows.push(...chunk);
    const reportedSize = res.data.meta?.size;
    size = typeof reportedSize === "number" && reportedSize > 0 ? reportedSize : rows.length;
    if (chunk.length < pageLimit) break;
    offset += pageLimit;
  }

  const oils: OilProduct[] = [];

  for (const r of rows) {
    const attrs = (r.attributes ?? []).reduce((acc, a) => {
      const attrId = a.meta?.href?.split("/").pop() ?? a.id;
      acc[attrId] = typeof a.value === "string" ? a.value : String(a.value ?? "");
      return acc;
    }, {} as Record<string, string>);

    const saeRaw = MOYSKLAD_ATTR_SAE ? attrs[MOYSKLAD_ATTR_SAE] : "";
    const oemRaw = MOYSKLAD_ATTR_OEM ? attrs[MOYSKLAD_ATTR_OEM] : "";
    const aceaRaw = MOYSKLAD_ATTR_ACEA ? attrs[MOYSKLAD_ATTR_ACEA] : "";
    const apiRaw = MOYSKLAD_ATTR_API ? attrs[MOYSKLAD_ATTR_API] : "";
    const volRaw = MOYSKLAD_ATTR_VOLUME ? attrs[MOYSKLAD_ATTR_VOLUME] : "";

    const nameLower = (r.name ?? "").toLowerCase();
    const nameLooksLikeOil =
      nameLower.includes("масл") ||
      nameLower.includes("oil") ||
      normalizeSAE(r.name ?? "").length > 0 ||
      normalizeACEA(r.name ?? "").length > 0;

    if (MOYSKLAD_ATTR_CATEGORY) {
      const cat = attrs[MOYSKLAD_ATTR_CATEGORY] ?? "";
      // Если UUID категории указан, но у карточки поле пустое — не выкидываем строку:
      // иначе весь каталог даёт 0 «масляных» товаров (частая ошибка настройки .env).
      if (cat.trim()) {
        if (!cat.toLowerCase().includes("масл") && !cat.toLowerCase().includes("oil") && !nameLooksLikeOil) continue;
      } else {
        if (!nameLooksLikeOil && !saeRaw) continue;
      }
    } else {
      if (!nameLooksLikeOil && !saeRaw) continue;
    }

    const ilsacRaw = MOYSKLAD_ATTR_ILSAC ? attrs[MOYSKLAD_ATTR_ILSAC] : "";
    // Важно: поиск кандидатов делается по доп. полям, но для матчинга SAE
    // делаем fallback из имени, чтобы не терять товары, у которых SAE атрибут
    // заполнен неполностью (а в названии SAE обычно указан).
    const requirements_norm = {
      sae: mergeUnique([normalizeSAE(saeRaw || ""), normalizeSAE(r.name ?? "")]),
      oem: mergeUnique([normalizeOEM(oemRaw || ""), normalizeOEM(r.name ?? "")]),
      acea: mergeUnique([normalizeACEA(aceaRaw || ""), normalizeACEA(r.name ?? "")]),
      api: mergeUnique([normalizeAPI(apiRaw || ""), normalizeAPI(r.name ?? "")]),
      ilsac: mergeUnique([normalizeILSAC(ilsacRaw || ""), normalizeILSAC(r.name ?? "")]),
    };

    let volume_liters: number | undefined;
    if (volRaw) {
      const num = parseFloat(volRaw.replace(",", ".").replace(/[^\d.]/g, ""));
      if (!Number.isNaN(num)) volume_liters = num;
    }
    if (volume_liters == null) {
      const fromName = parsePackVolumeLitersFromOilName(r.name ?? "");
      if (fromName != null) volume_liters = fromName;
    }

    const priceCents = r.salePrices?.[0]?.value ?? 0;
    const price = priceCents / 100;
    const currency = r.salePrices?.[0]?.currency?.name ?? "руб.";

    oils.push({
      id: r.id,
      name: r.name ?? "",
      article: r.article,
      price,
      currency,
      meta: r.meta ?? { href: `${MOYSKLAD_BASE}/entity/product/${r.id}` },
      requirements_norm,
      volume_liters,
      imageHref: getFirstImageHref(r),
    });
  }

  return enrichOilLineRequirements(oils);
}

const OEM_ATTR_HREF =
  MOYSKLAD_ATTR_OEM ? `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MOYSKLAD_ATTR_OEM}` : "";
const SAE_ATTR_HREF =
  MOYSKLAD_ATTR_SAE ? `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MOYSKLAD_ATTR_SAE}` : "";
const ACEA_ATTR_HREF =
  MOYSKLAD_ATTR_ACEA ? `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MOYSKLAD_ATTR_ACEA}` : "";
const API_ATTR_HREF =
  MOYSKLAD_ATTR_API ? `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MOYSKLAD_ATTR_API}` : "";
const ILSAC_ATTR_HREF =
  MOYSKLAD_ATTR_ILSAC ? `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MOYSKLAD_ATTR_ILSAC}` : "";

/** Нормализация ILSAC (GF-5, GF-6 и т.д.) для поиска. */
function normalizeILSAC(value: string): string[] {
  if (!value || typeof value !== "string") return [];
  const parts = value.split(/[,;\/\s]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/GF-?(\d)/i);
    if (m) out.push(`GF-${m[1]}`);
    else if (p.length >= 2) out.push(p);
  }
  return [...new Set(out)];
}

/** Поиск масел в МойСклад только по допускам (OEM/SAE/ACEA/API/ILSAC) — без VIN/OpenAI. */
export async function fetchOilCandidatesByRequirements(requirements: OilRequirements): Promise<OilProduct[]> {
  const warmCatalog = getCachedOilProductsSnapshot();
  if (warmCatalog) return warmCatalog;

  const cacheKey = JSON.stringify({
    sae: requirements.sae_viscosities ?? [],
    oem: requirements.oem_approvals ?? [],
    acea: requirements.acea ?? [],
    api: requirements.api ?? [],
    ilsac: requirements.ilsac ?? [],
  });
  const cachedCandidates = oilCandidatesCache.get(cacheKey);
  if (cachedCandidates && Date.now() - cachedCandidates.at <= OIL_PRODUCTS_CACHE_TTL_MS) {
    return cloneOilProducts(cachedCandidates.products);
  }

  const auth = getMoySkladAuthHeader();
  if (!auth) return [];
  const headers: Record<string, string> = {
    Authorization: auth,
    Accept: "application/json;charset=utf-8",
  };
  const saeList = (requirements.sae_viscosities ?? []).flatMap((s) => normalizeSAE(s));
  const oemList = (requirements.oem_approvals ?? []).flatMap((s) => normalizeOEM(s));
  const aceaList = (requirements.acea ?? []).flatMap((s) => normalizeACEA(s));
  const apiList = (requirements.api ?? []).flatMap((s) => normalizeAPI(s));
  const ilsacList = (requirements.ilsac ?? []).flatMap((s) => normalizeILSAC(s));
  const terms: { value: string; href: string }[] = [];
  const seen = new Set<string>();
  const add = (v: string, href: string) => {
    const key = v.replace(/\s/g, "").toLowerCase();
    if (key.length >= 2 && !seen.has(key)) {
      seen.add(key);
      terms.push({ value: v, href });
    }
  };
  if (oemList.length > 0) {
    if (OEM_ATTR_HREF) oemList.forEach((v) => add(v, OEM_ATTR_HREF));
    if (SAE_ATTR_HREF) saeList.forEach((v) => add(v, SAE_ATTR_HREF));
  } else {
    if (SAE_ATTR_HREF) saeList.forEach((v) => add(v, SAE_ATTR_HREF));
    if (ACEA_ATTR_HREF) {
      aceaList.forEach((v) => {
        add(v, ACEA_ATTR_HREF);
        if (/^[A-C]\d/i.test(v)) add(`ACEA ${v}`, ACEA_ATTR_HREF);
      });
    }
    if (API_ATTR_HREF) {
      apiList.forEach((v) => {
        add(v, API_ATTR_HREF);
        add(`API ${v}`, API_ATTR_HREF);
      });
    }
    if (ILSAC_ATTR_HREF) {
      ilsacList.forEach((v) => {
        add(v, ILSAC_ATTR_HREF);
        if (/^GF-/i.test(v)) add(`ILSAC ${v}`, ILSAC_ATTR_HREF);
      });
    }
  }

  const rowMap = new Map<string, ProductRow>();
  const rowsList = await Promise.all(
    terms.map(async ({ value, href }) => {
      try {
        const res = await fetch(
          `${MOYSKLAD_BASE}/entity/product?filter=${encodeURIComponent(href)}~${encodeURIComponent(value)}&limit=100&expand=attributes,images`,
          { headers }
        );
        if (!res.ok) return [] as ProductRow[];
        const data = (await res.json()) as { rows?: ProductRow[] };
        return data.rows ?? [];
      } catch {
        return [] as ProductRow[];
      }
    })
  );
  for (const rows of rowsList) {
    for (const row of rows) {
      if (!rowMap.has(row.id)) rowMap.set(row.id, row);
    }
  }

  // Часть карточек в МойСклад заполнена только названием ("Takayama ... 5W-30 C3 ..."),
  // без доп. полей SAE/ACEA. Атрибутный filter их не найдёт, поэтому добираем кандидатов
  // обычным поиском по названию/описанию и дальше всё равно прогоняем через scoreAndMatch.
  const nameSearchValues = [
    ...new Set(
      [...saeList, ...saeList.map((v) => v.replace("-", "")), ...aceaList, ...oemList]
        .map((v) => v.trim())
        .filter((v) => v.length >= 2)
    ),
  ];
  const nameRowsList = await Promise.all(
    nameSearchValues.map(async (value) => {
      try {
        const res = await fetch(
          `${MOYSKLAD_BASE}/entity/product?search=${encodeURIComponent(value)}&limit=100&expand=attributes,images`,
          { headers }
        );
        if (!res.ok) return [] as ProductRow[];
        const data = (await res.json()) as { rows?: ProductRow[] };
        return data.rows ?? [];
      } catch {
        return [] as ProductRow[];
      }
    })
  );
  for (const rows of nameRowsList) {
    for (const row of rows) {
      if (!rowMap.has(row.id)) rowMap.set(row.id, row);
    }
  }

  // Если нашли одну фасовку линейки, добираем остальные фасовки этой же линейки
  // (часто у соседней фасовки не заполнены SAE/ACEA или она не попала в первые 100 search-результатов).
  const baseNames = [
    ...new Set(
      [...rowMap.values()]
        .map((row) => getOilLineBaseName(row.name ?? "", parsePackVolumeLitersFromOilName(row.name ?? "")))
        .filter((name) => name.length >= 6)
    ),
  ].slice(0, 80);
  const siblingRowsList = await Promise.all(
    baseNames.map(async (baseName) => {
      try {
        const res = await fetch(
          `${MOYSKLAD_BASE}/entity/product?search=${encodeURIComponent(baseName)}&limit=50&expand=attributes,images`,
          { headers }
        );
        if (!res.ok) return [] as ProductRow[];
        const data = (await res.json()) as { rows?: ProductRow[] };
        return data.rows ?? [];
      } catch {
        return [] as ProductRow[];
      }
    })
  );
  for (const rows of siblingRowsList) {
    for (const row of rows) {
      if (!rowMap.has(row.id)) rowMap.set(row.id, row);
    }
  }

  const oils: OilProduct[] = [];
  for (const r of rowMap.values()) {
    const attrs: Record<string, string> = {};
    for (const a of r.attributes ?? []) {
      const id = a.meta?.href?.split("/").pop() ?? a.id;
      attrs[id] = typeof a.value === "string" ? a.value : String(a.value ?? "");
    }
    const saeRaw = MOYSKLAD_ATTR_SAE ? attrs[MOYSKLAD_ATTR_SAE] : "";
    const oemRaw = MOYSKLAD_ATTR_OEM ? attrs[MOYSKLAD_ATTR_OEM] : "";
    const aceaRaw = MOYSKLAD_ATTR_ACEA ? attrs[MOYSKLAD_ATTR_ACEA] : "";
    const apiRaw = MOYSKLAD_ATTR_API ? attrs[MOYSKLAD_ATTR_API] : "";
    const ilsacRaw = MOYSKLAD_ATTR_ILSAC ? attrs[MOYSKLAD_ATTR_ILSAC] : "";
    const requirements_norm = {
      sae: mergeUnique([normalizeSAE(saeRaw || ""), normalizeSAE(r.name ?? "")]),
      oem: mergeUnique([normalizeOEM(oemRaw || ""), normalizeOEM(r.name ?? "")]),
      acea: mergeUnique([normalizeACEA(aceaRaw || ""), normalizeACEA(r.name ?? "")]),
      api: mergeUnique([normalizeAPI(apiRaw || ""), normalizeAPI(r.name ?? "")]),
      ilsac: mergeUnique([normalizeILSAC(ilsacRaw || ""), normalizeILSAC(r.name ?? "")]),
    };
    const hasAnyNorm =
      requirements_norm.sae.length +
        requirements_norm.oem.length +
        requirements_norm.acea.length +
        requirements_norm.api.length +
        requirements_norm.ilsac.length >
      0;
    if (!hasAnyNorm) continue;
    let volume_liters: number | undefined;
    const volRaw = MOYSKLAD_ATTR_VOLUME ? attrs[MOYSKLAD_ATTR_VOLUME] : "";
    if (volRaw) {
      const num = parseFloat(volRaw.replace(",", ".").replace(/[^\d.]/g, ""));
      if (!Number.isNaN(num)) volume_liters = num;
    }
    if (volume_liters == null) {
      const fromName = parsePackVolumeLitersFromOilName(r.name ?? "");
      if (fromName != null) volume_liters = fromName;
    }
    const priceCents = r.salePrices?.[0]?.value ?? 0;
    oils.push({
      id: r.id,
      name: r.name ?? "",
      article: r.article,
      price: priceCents / 100,
      currency: r.salePrices?.[0]?.currency?.name ?? "руб.",
      meta: r.meta ?? { href: `${MOYSKLAD_BASE}/entity/product/${r.id}` },
      requirements_norm,
      volume_liters,
      imageHref: getFirstImageHref(r),
    });
  }
  const enriched = enrichOilLineRequirements(oils);
  oilCandidatesCache.set(cacheKey, { at: Date.now(), products: cloneOilProducts(enriched) });
  return enriched;
}

const SCORE_OEM = 100;
const SCORE_ACEA = 30;
const SCORE_API = 10;
const SCORE_ILSAC = 10;
const SCORE_SAE = 20;

function intersection(a: string[], b: string[]): number {
  const set = new Set(b.map((s) => s.toUpperCase()));
  return a.filter((s) => set.has(s.toUpperCase())).length;
}

function toRecommendationItem(item: OilRecommendationItem & { saeMatch: number; oemMatch: number; aceaMatch: number; apiMatch: number }): OilRecommendationItem {
  return {
    product: item.product,
    score: item.score,
    why: item.why,
  };
}

/** Нормализовать входящие требования для сравнения с product.requirements_norm */
            function normReq(
              req: OilRequirements
            ): { sae: string[]; oem: string[]; acea: string[]; api: string[]; ilsac: string[] } {
  return {
    sae: (req.sae_viscosities ?? []).flatMap((s) => normalizeSAE(s)),
    oem: (req.oem_approvals ?? []).flatMap((s) => normalizeOEM(s)),
    acea: (req.acea ?? []).flatMap((s) => normalizeACEA(s)),
    api: (req.api ?? []).flatMap((s) => normalizeAPI(s)),
                ilsac: (req.ilsac ?? []).flatMap((s) => normalizeILSAC(s)),
  };
}

/** Скоринг и матчинг: recommended (топ N), alternatives (следующие altLimit), why. */
export function scoreAndMatch(
  requirements: OilRequirements,
  products: OilProduct[],
  topN = 10,
  altLimit = 10
): { recommended: OilRecommendationItem[]; alternatives: OilRecommendationItem[] } {
  const req = normReq(requirements);
  const needSae = req.sae.length > 0;
  const needOem = req.oem.length > 0;
  const needAcea = req.acea.length > 0;
  const needApi = req.api.length > 0;
  const needIlsac = req.ilsac.length > 0;

  type ScoredMatch = OilRecommendationItem & {
    saeMatch: number;
    oemMatch: number;
    aceaMatch: number;
    apiMatch: number;
    ilsacMatch: number;
  };

  const scoredAll: ScoredMatch[] = [];

  for (const product of products) {
    const p = product.requirements_norm;
    const saeMatch = intersection(p.sae, req.sae);
    const oemMatch = intersection(p.oem, req.oem);
    const aceaMatch = intersection(p.acea, req.acea);
    const apiMatch = intersection(p.api, req.api);
    const ilsacMatch = intersection(p.ilsac, req.ilsac);

    if (needOem) {
      if (oemMatch === 0) continue;
      if (needSae && saeMatch === 0) continue;
    } else {
      if (needSae && saeMatch === 0) continue;
      if (needAcea && aceaMatch === 0) continue;
      if (needApi && apiMatch === 0) continue;
      if (needIlsac && ilsacMatch === 0) continue;
    }

    let score = 0;
    const why: string[] = [];
    if (saeMatch > 0) {
      score += SCORE_SAE * saeMatch;
      why.push(`SAE: ${p.sae.filter((s) => req.sae.some((r) => r.toUpperCase() === s.toUpperCase())).join(", ")}`);
    }
    if (oemMatch > 0) {
      score += SCORE_OEM * oemMatch;
      why.push(`OEM: ${p.oem.filter((o) => req.oem.some((r) => r.toUpperCase() === o.toUpperCase())).join(", ")}`);
    }
    if (aceaMatch > 0) {
      score += SCORE_ACEA * aceaMatch;
      why.push(`ACEA: ${p.acea.filter((a) => req.acea.some((r) => r.toUpperCase() === a.toUpperCase())).join(", ")}`);
    }
    if (apiMatch > 0) {
      score += SCORE_API * apiMatch;
      why.push(`API: ${p.api.filter((a) => req.api.some((r) => r.toUpperCase() === a.toUpperCase())).join(", ")}`);
    }
    if (ilsacMatch > 0) {
      score += SCORE_ILSAC * ilsacMatch;
      why.push(`ILSAC: ${p.ilsac.filter((v) => req.ilsac.some((r) => r.toUpperCase() === v.toUpperCase())).join(", ")}`);
    }

    scoredAll.push({ product, score, why, saeMatch, oemMatch, aceaMatch, apiMatch, ilsacMatch });
  }

  scoredAll.sort((a, b) => b.score - a.score || a.product.price - b.product.price);
  const recommended = scoredAll.slice(0, topN).map(toRecommendationItem);
  const alternatives = scoredAll.slice(topN, topN + altLimit).map(toRecommendationItem);
  return { recommended, alternatives };
}
